"""People and invite codes: sub-accounts that work inside the owner's
properties, and (admins only) separate accounts with their own data."""
from __future__ import annotations

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import AuditLog, Invite, User, WebSession
from ..services import audit
from .auth import client_ip, user_any

router = APIRouter(prefix="/api/accounts")


def _iso(d):
    return d.isoformat() if d else None


def _user_dict(u: User, s: Session) -> dict:
    parent = s.get(User, u.parent_id) if u.parent_id else None
    return {"id": u.id, "name": u.display_name or u.email.split("@")[0], "email": u.email,
            "role": "user" if u.parent_id else u.role, "sub_account": u.parent_id is not None,
            "parent": (parent.display_name or parent.email) if parent else None,
            "disabled": u.disabled, "totp": u.totp_enabled,
            "created_at": _iso(u.created_at), "last_login_at": _iso(u.last_login_at)}


def _invite_dict(i: Invite, s: Session) -> dict:
    used = s.get(User, i.used_by) if i.used_by else None
    return {"code": i.code, "note": i.note, "kind": "sub" if i.parent_id else "separate",
            "role": i.role, "created_at": _iso(i.created_at), "used_by": used.email if used else None,
            "used_at": _iso(i.used_at), "revoked": i.revoked}


def _main_only(user: User) -> None:
    if user.parent_id is not None:
        raise HTTPException(403, "Sub-accounts can't manage people. Ask the account owner.")


@router.get("")
def overview(user: User = Depends(user_any), s: Session = Depends(get_session)):
    _main_only(user)
    members = s.scalars(select(User).where(User.parent_id == user.id).order_by(User.created_at))
    if user.is_admin:
        inv_q = select(Invite)
    else:
        inv_q = select(Invite).where(or_(Invite.created_by == user.id, Invite.parent_id == user.id))
    invites = s.scalars(inv_q.order_by(Invite.created_at.desc()).limit(50))
    out = {"can_invite_separate": user.is_admin,
           "members": [_user_dict(u, s) for u in members],
           "invites": [_invite_dict(i, s) for i in invites]}
    if user.is_admin:
        out["users"] = [_user_dict(u, s) for u in s.scalars(select(User).order_by(User.created_at))]
        out["audit"] = [{"ts": _iso(a.ts), "actor": a.actor_label, "action": a.action}
                        for a in s.scalars(select(AuditLog).order_by(AuditLog.ts.desc()).limit(50))]
    return out


class InviteIn(BaseModel):
    note: str = Field(default="", max_length=120)
    kind: Literal["sub", "separate"] = "sub"


@router.post("/invites")
def create_invite(body: InviteIn, request: Request, user: User = Depends(user_any),
                  s: Session = Depends(get_session)):
    _main_only(user)
    if body.kind == "separate" and not user.is_admin:
        raise HTTPException(403, "Only an admin can invite a separate account")
    code = "RENT-" + "-".join(secrets.token_hex(2).upper() for _ in range(2))
    s.add(Invite(code=code, note=body.note.strip(), role="user", created_by=user.id,
                 parent_id=user.id if body.kind == "sub" else None))
    what = "sub-account" if body.kind == "sub" else "separate account"
    audit(s, f"Created {what} invite {code}" + (f" ({body.note.strip()})" if body.note.strip() else ""),
          user, client_ip(request))
    return {"code": code}


@router.delete("/invites/{code}")
def revoke_invite(code: str, request: Request, user: User = Depends(user_any),
                  s: Session = Depends(get_session)):
    _main_only(user)
    inv = s.get(Invite, code.strip().upper())
    if inv is None or not (user.is_admin or inv.created_by == user.id or inv.parent_id == user.id):
        raise HTTPException(404, "Invite not found")
    if inv.used_by is not None:
        raise HTTPException(400, "This invite was already used. Turn off the person's access instead.")
    inv.revoked = True
    audit(s, f"Revoked invite {inv.code}", user, client_ip(request))
    return {"ok": True}


class UserActionIn(BaseModel):
    action: Literal["disable", "enable"]


@router.post("/users/{user_id}")
def user_action(user_id: int, body: UserActionIn, request: Request, user: User = Depends(user_any),
                s: Session = Depends(get_session)):
    _main_only(user)
    u = s.get(User, user_id)
    if u is None or not (user.is_admin or u.parent_id == user.id):
        raise HTTPException(404, "User not found")
    if u.id == user.id:
        raise HTTPException(400, "You can't turn off your own account")
    u.disabled = body.action == "disable"
    if u.disabled:
        for row in s.scalars(select(WebSession).where(WebSession.user_id == u.id)):
            s.delete(row)
    audit(s, f"{'Turned off' if u.disabled else 'Turned on'} access for {u.email}", user, client_ip(request))
    return _user_dict(u, s)
