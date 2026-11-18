"""Encryption for secrets stored in the database (tenant ID numbers, TOTP seeds).

Fernet (AES-128-CBC + HMAC-SHA256). The key lives in the environment
(LEMONRENT_SECRET_KEY), never in the database, so a stolen database dump alone
does not reveal them.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from .settings import get_settings


class SecretKeyMissing(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = get_settings().secret_key
    if not key:
        raise SecretKeyMissing("LEMONRENT_SECRET_KEY is not set")
    return Fernet(key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("stored secret cannot be decrypted with the current key") from exc


def generate_key() -> str:
    return Fernet.generate_key().decode()
