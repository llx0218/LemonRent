"""Sessions, password hashing, TOTP and login throttling.

- Passwords: argon2id.
- Sessions: random 32-byte token in an HttpOnly, Secure, SameSite=Lax cookie;
  only its SHA-256 is stored, so a database leak does not leak live sessions.
- CSRF: every state-changing request must carry the `X-LemonRent: 1` header.
  Browsers cannot add a custom header cross-site without a CORS preflight,
  and this API answers no CORS, so a foreign page cannot forge requests.
- Two-factor (TOTP) is optional, chosen per user in Settings. Once on, it is
  asked at every sign-in, and turning it off needs the password AND a code.
- Throttle: per email+IP (5 failures), per email from anywhere (20) and per IP
  for any email (30), each locking for 15 minutes.
- At most HASH_SLOTS password hashes run at once per process: argon2 uses
  64 MiB each, and this app shares its server with LemonBot's trading engine.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
from datetime import timedelta
from typing import Optional

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..crypto import decrypt
from ..db import get_session, session_scope, utcnow
from ..models import LoginThrottle, User, WebSession
from ..settings import get_settings

COOKIE = "lemonrent_session"
MAX_FAILURES = 5
MAX_FAILURES_ACCOUNT = 20
MAX_FAILURES_IP = 30
LOCK_MINUTES = 15
HASH_SLOTS = 1

_ph = PasswordHasher()
_hash_slots = threading.BoundedSemaphore(HASH_SLOTS)
_DUMMY_HASH = _ph.hash(secrets.token_urlsafe(16))


def hash_password(pw: str) -> str:
    with _hash_slots:
        return _ph.hash(pw)


def verify_password(hashed: Optional[str], pw: str) -> bool:
    """`hashed=None` (unknown email) still costs one hash, so the answer time
    does not reveal which emails have accounts."""
    with _hash_slots:
        try:
            return _ph.verify(hashed or _DUMMY_HASH, pw) and hashed is not None
        except (VerifyMismatchError, InvalidHashError):
            return False


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def client_ip(request: Request) -> str:
    return (request.client.host if request.client else "")[:64]


def create_session(s: Session, user: User, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    days = get_settings().session_days
    s.add(WebSession(id=_digest(token), user_id=user.id,
                     expires_at=utcnow() + timedelta(days=days),
                     ip=client_ip(request),
                     user_agent=(request.headers.get("user-agent") or "")[:300]))
    response.set_cookie(COOKIE, token, max_age=days * 86400, httponly=True,
                        secure=get_settings().cookie_secure, samesite="lax", path="/")


def end_session(s: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        row = s.get(WebSession, _digest(token))
        if row is not None:
            s.delete(row)
    response.delete_cookie(COOKIE, path="/")


def current_session(request: Request, s: Session) -> Optional[WebSession]:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    row = s.get(WebSession, _digest(token))
    if row is None or row.expires_at <= utcnow():
        return None
    now = utcnow()
    if (now - row.last_seen_at).total_seconds() > 300:
        row.last_seen_at = now
    return row


def csrf_guard(request: Request) -> None:
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("x-lemonrent") != "1":
            raise HTTPException(403, "Missing request header")


def user_any(request: Request, s: Session = Depends(get_session)) -> User:
    """Signed in (with 2FA if the user turned it on)."""
    csrf_guard(request)
    sess = current_session(request, s)
    if sess is None:
        raise HTTPException(401, "Not signed in")
    user = s.get(User, sess.user_id)
    if user is None or user.disabled:
        raise HTTPException(401, "Not signed in")
    if user.parent_id is not None:
        parent = s.get(User, user.parent_id)
        if parent is None or parent.disabled:
            raise HTTPException(401, "Not signed in")
    request.state.session_id = sess.id
    return user


def admin_only(user: User = Depends(user_any)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Admins only")
    return user


def verify_totp(user: User, code: str) -> bool:
    if not user.totp_secret_enc:
        return False
    code = (code or "").replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return False
    return pyotp.TOTP(decrypt(user.totp_secret_enc)).verify(code, valid_window=1)


def throttle_key(email: str, request: Request) -> str:
    """The email+IP key. Its siblings (email from anywhere, IP for any email)
    are derived from it; all start with `email|` except the IP one, so the CLI
    password reset (which clears `email|*`) unlocks the account."""
    return f"{email.lower().strip()}|{client_ip(request)}"


def _keys(key: str) -> list:
    email, _, ip = key.partition("|")
    if email == "register":
        return [(key, MAX_FAILURES), (f"*|{ip}", MAX_FAILURES_IP)]
    return [(key, MAX_FAILURES), (f"{email}|*", MAX_FAILURES_ACCOUNT),
            (f"*|{ip}", MAX_FAILURES_IP)]


def check_throttle(s: Session, key: str) -> None:
    for k, _ in _keys(key):
        row = s.get(LoginThrottle, k)
        if row and row.locked_until and row.locked_until > utcnow():
            mins = int((row.locked_until - utcnow()).total_seconds() // 60) + 1
            raise HTTPException(429, f"Too many attempts. Try again in {mins} min.")


def record_failure(key: str) -> None:
    """Own transaction: the request's session is rolled back when the login
    fails, and the failure count must survive that."""
    with session_scope() as s:
        for k, limit in _keys(key):
            row = s.get(LoginThrottle, k)
            if row is None:
                row = LoginThrottle(key=k, failures=0)
                s.add(row)
            if row.locked_until and row.locked_until <= utcnow():
                row.failures = 0
                row.locked_until = None
            row.failures += 1
            row.updated_at = utcnow()
            if row.failures >= limit:
                row.locked_until = utcnow() + timedelta(minutes=LOCK_MINUTES)


def clear_failures(s: Session, key: str) -> None:
    """A successful sign-in clears the email+IP and the email counters (not
    the per-IP one, which may be counting other emails)."""
    for k, _ in _keys(key)[:2]:
        row = s.get(LoginThrottle, k)
        if row is not None:
            s.delete(row)
