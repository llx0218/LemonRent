"""Operator commands.

    python -m lemonrent.cli invite --admin --note "me"
    python -m lemonrent.cli reset-2fa EMAIL
    python -m lemonrent.cli reset-password EMAIL
    python -m lemonrent.cli unlock EMAIL
"""

from __future__ import annotations

import argparse
import secrets
import sys

from sqlalchemy import select

from .db import session_scope
from .models import Invite, LoginThrottle, User, WebSession
from .services import audit


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="lemonrent")
    sub = ap.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("invite", help="create an invite code")
    inv.add_argument("--admin", action="store_true")
    inv.add_argument("--note", default="")
    r = sub.add_parser("reset-2fa", help="turn off 2FA for a user who lost their phone")
    r.add_argument("email")
    rp = sub.add_parser("reset-password", help="give a user a temporary password")
    rp.add_argument("email")
    ul = sub.add_parser("unlock", help="lift a sign-in lockout")
    ul.add_argument("email")
    args = ap.parse_args(argv)

    with session_scope() as s:
        if args.cmd == "invite":
            code = "RENT-" + "-".join(secrets.token_hex(2).upper() for _ in range(2))
            s.add(Invite(code=code, note=args.note, role="admin" if args.admin else "user"))
            audit(s, f"Created {'admin ' if args.admin else ''}invite {code} (CLI)")
            print(code)
            return 0
        email = args.email.lower().strip()
        if args.cmd == "unlock":
            rows = list(s.scalars(select(LoginThrottle).where(LoginThrottle.key.startswith(f"{email}|"))))
            for row in rows:
                s.delete(row)
            audit(s, f"Sign-in lockout lifted for {email} (CLI)")
            print(f"unlocked {email} ({len(rows)} counter(s) cleared)")
            return 0
        u = s.scalar(select(User).where(User.email == email))
        if u is None:
            print("no such user", file=sys.stderr)
            return 1
        if args.cmd == "reset-2fa":
            u.totp_enabled = False
            u.totp_secret_enc = None
            audit(s, f"2FA reset for {u.email} (CLI)")
            print(f"2FA reset for {u.email}; they can turn it on again in Settings")
        elif args.cmd == "reset-password":
            from .web.auth import hash_password
            temp = "-".join(secrets.token_urlsafe(6) for _ in range(3))
            u.password_hash = hash_password(temp)
            for row in s.scalars(select(WebSession).where(WebSession.user_id == u.id)):
                s.delete(row)
            for row in s.scalars(select(LoginThrottle).where(LoginThrottle.key.startswith(f"{u.email}|"))):
                s.delete(row)
            audit(s, f"Password reset for {u.email} (CLI)")
            print(f"temporary password for {u.email}: {temp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
