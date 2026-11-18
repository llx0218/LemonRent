from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

os.environ.setdefault("LEMONRENT_SECRET_KEY", "2dY4l8gZ0nS6c3Yq2m0bV7h1Qk5rX9tE4uW8pA6sD1E=")
os.environ["COOKIE_SECURE"] = "0"


@pytest.fixture()
def db():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from lemonrent import models  # noqa: F401
    from lemonrent.db import Base, set_engine

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    set_engine(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def client(db):
    from fastapi.testclient import TestClient

    from lemonrent.db import session_scope
    from lemonrent.models import Invite
    from lemonrent.web.app import app
    with session_scope() as s:
        s.add(Invite(code="RENT-TEST-0001", role="admin"))
        s.add(Invite(code="RENT-TEST-0002", role="user"))
    return TestClient(app, base_url="http://testserver")
