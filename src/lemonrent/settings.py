"""Runtime settings. Secrets come from the environment only (in production
/etc/lemonrent/lemonrent.env), never from the repository."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    database_url: str
    secret_key: str | None
    public_app_url: str
    cookie_secure: bool
    currency: str
    session_days: int = 14


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        database_url=_env("DATABASE_URL", "postgresql+psycopg://lemonrent@localhost/lemonrent"),
        secret_key=_env("LEMONRENT_SECRET_KEY"),
        public_app_url=_env("PUBLIC_APP_URL", "https://rent.example.com").rstrip("/"),
        cookie_secure=_env("COOKIE_SECURE", "1") == "1",
        currency=_env("CURRENCY", "RM"),
    )
