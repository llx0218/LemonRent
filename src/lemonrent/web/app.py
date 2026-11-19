"""LemonRent web API (served at https://rent.example.com/api behind Caddy).

    uvicorn lemonrent.web.app:app --host 127.0.0.1 --port 8100 --proxy-headers
"""

from __future__ import annotations

import re
from typing import Optional

import pyotp
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..crypto import encrypt
from ..db import get_session, utcnow
from ..models import Invite, User, WebSession
from ..services import audit
from ..settings import get_settings
from .auth import (check_throttle, clear_failures, client_ip, create_session, csrf_guard,
                   end_session, hash_password, record_failure, throttle_key, user_any,
                   verify_password, verify_totp)
from .accounts import router as accounts_router
from .rentals import router as rentals_router

app = FastAPI(title="LemonRent API", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(rentals_router)
app.include_router(accounts_router)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


def me_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.display_name or u.email.split("@")[0],
            "role": "user" if u.parent_id else u.role, "sub_account": u.parent_id is not None,
            "totp_enabled": u.totp_enabled, "currency": get_settings().currency}


@app.get("/api/health")
def health(s: Session = Depends(get_session)):
    s.execute(text("SELECT 1"))
    return {"ok": True}


class RegisterIn(BaseModel):
    invite_code: str = Field(min_length=4, max_length=32)
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=255)
    password: str = Field(min_length=10, max_length=200)


@app.post("/api/auth/register")
def register(body: RegisterIn, request: Request, response: Response,
             s: Session = Depends(get_session)):
    csrf_guard(request)
    email = body.email.lower().strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address")
    tkey = throttle_key("register", request)
    check_throttle(s, tkey)
    inv = s.get(Invite, body.invite_code.strip().upper())
    if inv is None or inv.revoked or inv.used_by is not None:
        record_failure(tkey)
        raise HTTPException(400, "Invite code is not valid")
    if s.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(400, "An account with this email already exists")
    if inv.parent_id is not None:
        parent = s.get(User, inv.parent_id)
        if parent is None or parent.disabled or parent.parent_id is not None:
            record_failure(tkey)
            raise HTTPException(400, "Invite code is not valid")
    user = User(email=email, display_name=body.name.strip(), password_hash=hash_password(body.password),
                role="user" if inv.parent_id else (inv.role or "user"), parent_id=inv.parent_id)
    s.add(user)
    s.flush()
    inv.used_by = user.id
    inv.used_at = utcnow()
    user.last_login_at = inv.used_at
    audit(s, f"Registered with invite {inv.code}", user, client_ip(request))
    create_session(s, user, request, response)
    return me_dict(user)


class LoginIn(BaseModel):
    email: str
    password: str
    code: Optional[str] = None


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response,
          s: Session = Depends(get_session)):
    csrf_guard(request)
    key = throttle_key(body.email, request)
    check_throttle(s, key)
    user = s.scalar(select(User).where(User.email == body.email.lower().strip()))
    ok = verify_password(user.password_hash if user else None, body.password)
    if user is None or user.disabled or not ok:
        record_failure(key)
        raise HTTPException(401, "Email or password is incorrect")
    if user.totp_enabled:
        if not body.code:
            return {"need_code": True}
        if not verify_totp(user, body.code):
            record_failure(key)
            raise HTTPException(401, "Authenticator code is incorrect")
    clear_failures(s, key)
    user.last_login_at = utcnow()
    create_session(s, user, request, response)
    audit(s, "Signed in", user, client_ip(request))
    return me_dict(user)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, s: Session = Depends(get_session)):
    csrf_guard(request)
    end_session(s, request, response)
    return {"ok": True}


@app.get("/api/me")
def me(user: User = Depends(user_any)):
    return me_dict(user)


@app.post("/api/auth/2fa/setup")
def totp_setup(user: User = Depends(user_any)):
    if user.totp_enabled:
        raise HTTPException(400, "Two-factor authentication is already on")
    secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt(secret)
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="LemonRent")
    return {"secret": secret, "uri": uri}


class CodeIn(BaseModel):
    code: str


@app.post("/api/auth/2fa/enable")
def totp_enable(body: CodeIn, request: Request, user: User = Depends(user_any),
                s: Session = Depends(get_session)):
    if user.totp_enabled:
        return me_dict(user)
    if not verify_totp(user, body.code):
        raise HTTPException(400, "That code did not match. Check your phone's time and try again.")
    user.totp_enabled = True
    audit(s, "Enabled two-factor authentication", user, client_ip(request))
    return me_dict(user)


class DisableTotpIn(BaseModel):
    password: str
    code: str


@app.post("/api/auth/2fa/disable")
def totp_disable(body: DisableTotpIn, request: Request, user: User = Depends(user_any),
                 s: Session = Depends(get_session)):
    if not user.totp_enabled:
        return me_dict(user)
    key = throttle_key(user.email, request)
    check_throttle(s, key)
    if not verify_password(user.password_hash, body.password):
        record_failure(key)
        raise HTTPException(400, "Password is incorrect")
    if not verify_totp(user, body.code):
        record_failure(key)
        raise HTTPException(400, "Authenticator code is incorrect")
    clear_failures(s, key)
    user.totp_enabled = False
    user.totp_secret_enc = None
    audit(s, "Turned off two-factor authentication", user, client_ip(request))
    return me_dict(user)


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=10, max_length=200)


@app.post("/api/auth/password")
def change_password(body: PasswordIn, request: Request, user: User = Depends(user_any),
                    s: Session = Depends(get_session)):
    if not verify_password(user.password_hash, body.current):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new)
    for row in s.scalars(select(WebSession).where(WebSession.user_id == user.id,
                                                  WebSession.id != request.state.session_id)):
        s.delete(row)
    audit(s, "Changed password", user, client_ip(request))
    return {"ok": True}


@app.get("/api/auth/sessions")
def sessions(request: Request, user: User = Depends(user_any), s: Session = Depends(get_session)):
    rows = s.scalars(select(WebSession).where(WebSession.user_id == user.id,
                                              WebSession.expires_at > utcnow())
                     .order_by(WebSession.last_seen_at.desc()))
    return [{"id": r.id[:12], "current": r.id == request.state.session_id, "ip": r.ip,
             "user_agent": r.user_agent, "last_seen_at": r.last_seen_at.isoformat()} for r in rows]


@app.post("/api/auth/sessions/revoke-others")
def revoke_others(request: Request, user: User = Depends(user_any),
                  s: Session = Depends(get_session)):
    n = 0
    for row in s.scalars(select(WebSession).where(WebSession.user_id == user.id,
                                                  WebSession.id != request.state.session_id)):
        s.delete(row)
        n += 1
    audit(s, f"Signed out {n} other session(s)", user, client_ip(request))
    return {"revoked": n}
