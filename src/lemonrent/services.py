from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from .models import AuditLog, User


def audit(s: Session, action: str, actor: Optional[User] = None, ip: str = "") -> None:
    s.add(AuditLog(actor_id=actor.id if actor else None,
                   actor_label=(actor.display_name or actor.email) if actor else "System",
                   action=action[:200], ip=ip))
