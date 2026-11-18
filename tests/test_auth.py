import pyotp

H = {"X-LemonRent": "1"}


def register(c, code="RENT-TEST-0001", email="owner@example.com"):
    return c.post("/api/auth/register", headers=H, json={
        "invite_code": code, "name": "Owner", "email": email, "password": "correct horse 1"})


def test_register_needs_valid_invite(client):
    r = client.post("/api/auth/register", headers=H, json={
        "invite_code": "RENT-NOPE", "name": "x", "email": "x@y.z", "password": "0123456789"})
    assert r.status_code == 400


def test_register_login_logout(client):
    assert register(client).status_code == 200
    assert client.get("/api/me").json()["email"] == "owner@example.com"
    client.post("/api/auth/logout", headers=H)
    assert client.get("/api/me").status_code == 401
    r = client.post("/api/auth/login", headers=H, json={"email": "owner@example.com", "password": "correct horse 1"})
    assert r.status_code == 200


def test_csrf_header_required(client):
    register(client)
    r = client.post("/api/properties", json={"name": "X"})
    assert r.status_code == 403


def test_two_factor_flow(client):
    register(client)
    secret = client.post("/api/auth/2fa/setup", headers=H).json()["secret"]
    r = client.post("/api/auth/2fa/enable", headers=H, json={"code": pyotp.TOTP(secret).now()})
    assert r.json()["totp_enabled"]
    client.post("/api/auth/logout", headers=H)
    r = client.post("/api/auth/login", headers=H, json={"email": "owner@example.com", "password": "correct horse 1"})
    assert r.json() == {"need_code": True}
    r = client.post("/api/auth/login", headers=H, json={"email": "owner@example.com", "password": "correct horse 1",
                                                       "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200


def test_lockout_after_five_failures(client):
    register(client)
    client.post("/api/auth/logout", headers=H)
    for _ in range(5):
        client.post("/api/auth/login", headers=H, json={"email": "owner@example.com", "password": "wrong"})
    r = client.post("/api/auth/login", headers=H, json={"email": "owner@example.com", "password": "correct horse 1"})
    assert r.status_code == 429


def test_owners_cannot_see_each_other(client):
    register(client)
    pid = client.post("/api/properties", headers=H, json={"name": "Mine"}).json()["id"]
    client.post("/api/auth/logout", headers=H)
    register(client, code="RENT-TEST-0002", email="other@example.com")
    assert client.get(f"/api/properties/{pid}").status_code == 404
    assert client.get("/api/properties").json() == []
