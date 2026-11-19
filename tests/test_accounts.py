from fastapi.testclient import TestClient

from tests.test_auth import H, register


def other_client(client):
    return TestClient(client.app, base_url="http://testserver")


def join(c, code, email, name="Helper"):
    return c.post("/api/auth/register", headers=H, json={
        "invite_code": code, "name": name, "email": email, "password": "correct horse 1"})


def test_sub_account_shares_owner_data(client):
    register(client)
    pid = client.post("/api/properties", headers=H, json={"name": "Shared"}).json()["id"]
    code = client.post("/api/accounts/invites", headers=H, json={"note": "wife"}).json()["code"]
    assert code.startswith("RENT-")

    sub = other_client(client)
    r = join(sub, code, "wife@example.com")
    assert r.status_code == 200 and r.json()["sub_account"] is True and r.json()["role"] == "user"
    assert [p["id"] for p in sub.get("/api/properties").json()] == [pid]
    assert sub.put(f"/api/properties/{pid}", headers=H, json={"name": "Renamed"}).status_code == 200
    new_pid = sub.post("/api/properties", headers=H, json={"name": "By wife"}).json()["id"]
    assert {p["id"] for p in client.get("/api/properties").json()} == {pid, new_pid}

    assert sub.get("/api/accounts").status_code == 403
    assert sub.post("/api/accounts/invites", headers=H, json={}).status_code == 403
    assert join(other_client(client), code, "again@example.com").status_code == 400

    acc = client.get("/api/accounts").json()
    assert [m["email"] for m in acc["members"]] == ["wife@example.com"]
    assert acc["invites"][0]["used_by"] == "wife@example.com"
    assert client.delete(f"/api/accounts/invites/{code}", headers=H).status_code == 400

    mid = acc["members"][0]["id"]
    assert client.post(f"/api/accounts/users/{mid}", headers=H, json={"action": "disable"}).status_code == 200
    assert sub.get("/api/properties").status_code == 401
    client.post(f"/api/accounts/users/{mid}", headers=H, json={"action": "enable"})
    r = sub.post("/api/auth/login", headers=H, json={"email": "wife@example.com", "password": "correct horse 1"})
    assert r.status_code == 200
    assert sub.get("/api/properties").status_code == 200


def test_separate_accounts_need_admin_and_stay_separate(client):
    register(client)
    client.post("/api/properties", headers=H, json={"name": "Mine"})
    code = client.post("/api/accounts/invites", headers=H, json={"kind": "separate"}).json()["code"]
    other = other_client(client)
    assert join(other, code, "friend@example.com").json()["sub_account"] is False
    assert other.get("/api/properties").json() == []
    assert other.get("/api/accounts").json()["can_invite_separate"] is False
    assert other.post("/api/accounts/invites", headers=H, json={"kind": "separate"}).status_code == 403
    sub_code = other.post("/api/accounts/invites", headers=H, json={"kind": "sub"}).json()["code"]
    assert sub_code
    admin_view = client.get("/api/accounts").json()
    assert {u["email"] for u in admin_view["users"]} == {"owner@example.com", "friend@example.com"}
    assert any("sub-account invite" in a["action"] for a in admin_view["audit"])
    friend_id = next(u["id"] for u in admin_view["users"] if u["email"] == "friend@example.com")
    owner_id = next(u["id"] for u in admin_view["users"] if u["email"] == "owner@example.com")
    assert other.post(f"/api/accounts/users/{owner_id}", headers=H, json={"action": "disable"}).status_code == 404
    assert client.post(f"/api/accounts/users/{owner_id}", headers=H, json={"action": "disable"}).status_code == 400
    assert client.post(f"/api/accounts/users/{friend_id}", headers=H, json={"action": "disable"}).status_code == 200


def test_revoke_unused_invite(client):
    register(client)
    code = client.post("/api/accounts/invites", headers=H, json={}).json()["code"]
    assert client.delete(f"/api/accounts/invites/{code}", headers=H).status_code == 200
    assert join(other_client(client), code, "late@example.com").status_code == 400


def test_sub_account_cut_off_when_owner_disabled(client):
    register(client)
    code = client.post("/api/accounts/invites", headers=H, json={}).json()["code"]
    sub = other_client(client)
    join(sub, code, "helper@example.com")
    from lemonrent.db import session_scope
    from lemonrent.models import User
    with session_scope() as s:
        s.query(User).filter(User.email == "owner@example.com").one().disabled = True
    assert sub.get("/api/properties").status_code == 401
