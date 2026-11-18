from datetime import date

import pytest

from lemonrent import finance as fin
from tests.test_auth import H, register


@pytest.fixture()
def owner(client, monkeypatch):
    monkeypatch.setattr(fin, "today_myt", lambda: date(2026, 11, 18))
    register(client)
    return client


def make_property(c):
    return c.post("/api/properties", headers=H, json={
        "name": "Sky Residence A-12-3", "purchase_date": "2026-01-10",
        "purchase_price": 500000, "down_payment": 50000, "upfront_costs": 30000, "loan_amount": 450000,
        "units": [{"name": "Master room", "target_rent": 1200}, {"name": "Room 2", "target_rent": 800}],
        "commitments": [
            {"name": "Loan instalment", "kind": "loan", "amount": 2000},
            {"name": "Maintenance fee", "kind": "fee", "amount": 300},
            {"name": "Quit rent + assessment", "kind": "fee", "amount": 1200, "frequency": "yearly"},
        ]}).json()["id"]


def test_property_defaults_to_whole_unit(owner):
    pid = owner.post("/api/properties", headers=H, json={"name": "Studio"}).json()["id"]
    units = owner.get(f"/api/properties/{pid}").json()["units"]
    assert [u["name"] for u in units] == ["Whole unit"]


def test_tenancy_collect_and_returns(owner):
    pid = make_property(owner)
    units = owner.get(f"/api/properties/{pid}").json()["units"]
    r = owner.post("/api/tenancies", headers=H, json={
        "unit_id": units[0]["id"], "start_date": "2026-09-01", "end_date": "2027-08-31",
        "monthly_rent": 1200, "security_deposit": 2400, "utility_deposit": 600, "access_card_deposit": 100,
        "tenant": {"name": "Ali", "phone": "0123456789", "id_number": "900101-14-5678"}})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    rows = owner.get("/api/collect?month=2026-11").json()["rows"]
    assert len(rows) == 1
    assert rows[0]["previous_balance"] == 2400.0

    for m in ("2026-09", "2026-10"):
        owner.put("/api/records", headers=H, json={"tenancy_id": tid, "month": m, "rent_due": 1200,
                                                    "rent_paid": 1200, "electricity": 100, "water": 20,
                                                    "utilities_paid": 120})
    owner.put("/api/records", headers=H, json={"tenancy_id": tid, "month": "2026-11", "rent_due": 1200,
                                                "rent_paid": 500, "electricity": 90, "utilities_paid": 0})
    rows = owner.get("/api/collect?month=2026-11").json()["rows"]
    assert rows[0]["previous_balance"] == 0.0
    assert rows[0]["record"]["utilities_due"] == 90.0
    assert rows[0]["prev_bills"]["electricity"] == 100.0

    detail = owner.get(f"/api/properties/{pid}").json()
    st = detail["stats"]
    assert st["cash_invested"] == 80000.0
    assert st["commitment_monthly"] == 2400.0
    assert st["rent_now"] == 1200.0
    assert st["expected_net_monthly"] == -1200.0
    assert st["gross_yield_pct"] == pytest.approx(2.88)
    assert st["net_yield_pct"] == pytest.approx(1.92)
    assert st["months_owned"] == 10
    assert st["to_date"]["rent_in"] == 2400.0
    assert st["to_date"]["commitments"] == 24000.0
    assert st["to_date"]["net"] == 2400.0 + 240.0 - 240.0 - 24000.0
    assert st["last12"]["months"] == 10
    assert st["cash_on_cash_pct"] == pytest.approx(-21600.0 * 12 / 10 / 80000 * 100)
    assert st["units_occupied"] == 1 and st["units_active"] == 2
    assert st["arrears"] == 0.0

    t = owner.get(f"/api/tenants/{owner.get('/api/tenants').json()[0]['id']}").json()
    assert t["id_number"] == "900101-14-5678"
    assert t["id_number_masked"].endswith("5678") and "9001" not in t["id_number_masked"]
    assert t["tenancies"][0]["balance"]["outstanding"] == 790.0
    assert t["tenancies"][0]["access_card_deposit"] == 100.0

    ov = owner.get("/api/overview?month=2026-11").json()
    assert ov["month_expected"] == 1290.0
    assert ov["month_collected"] == 500.0
    assert ov["owing"][0]["outstanding"] == 790.0
    assert [v["name"] for v in ov["vacant"]] == ["Room 2"]


def test_overlapping_tenancy_rejected(owner):
    pid = make_property(owner)
    uid = owner.get(f"/api/properties/{pid}").json()["units"][0]["id"]
    body = {"unit_id": uid, "start_date": "2026-09-01", "monthly_rent": 1000, "tenant": {"name": "A"}}
    assert owner.post("/api/tenancies", headers=H, json=body).status_code == 200
    body["start_date"] = "2027-01-01"
    body["tenant"] = {"name": "B"}
    r = owner.post("/api/tenancies", headers=H, json=body)
    assert r.status_code == 400 and "already let" in r.json()["detail"]


def test_unrecorded_past_months_count_as_overdue(owner):
    pid = make_property(owner)
    uid = owner.get(f"/api/properties/{pid}").json()["units"][1]["id"]
    owner.post("/api/tenancies", headers=H, json={"unit_id": uid, "start_date": "2026-08-15",
                                                   "monthly_rent": 800, "tenant": {"name": "Siti"}})
    ov = owner.get("/api/overview").json()
    owing = ov["owing"][0]
    assert owing["overdue"] == 2400.0
    assert owing["overdue_months"] == ["2026-08", "2026-09", "2026-10"]
    assert owing["outstanding"] == 3200.0


def test_utilities_modes(owner):
    pid = make_property(owner)
    uid = owner.get(f"/api/properties/{pid}").json()["units"][0]["id"]
    tid = owner.post("/api/tenancies", headers=H, json={
        "unit_id": uid, "start_date": "2026-10-01", "monthly_rent": 1000, "utilities_mode": "tenant_direct",
        "tenant": {"name": "D"}}).json()["id"]
    rec = owner.put("/api/records", headers=H, json={"tenancy_id": tid, "month": "2026-10", "rent_due": 1000,
                                                      "rent_paid": 1000, "electricity": 150}).json()
    assert rec["utilities_due"] == 0.0
    st = owner.get(f"/api/properties/{pid}").json()["stats"]
    assert st["to_date"]["utilities_cost"] == 0.0


def test_unit_with_history_cannot_be_deleted(owner):
    pid = make_property(owner)
    uid = owner.get(f"/api/properties/{pid}").json()["units"][0]["id"]
    owner.post("/api/tenancies", headers=H, json={"unit_id": uid, "start_date": "2026-11-01",
                                                   "monthly_rent": 1000, "tenant": {"name": "E"}})
    assert owner.delete(f"/api/units/{uid}", headers=H).status_code == 400


def test_csv_export(owner):
    pid = make_property(owner)
    uid = owner.get(f"/api/properties/{pid}").json()["units"][0]["id"]
    tid = owner.post("/api/tenancies", headers=H, json={"unit_id": uid, "start_date": "2026-11-01",
                                                         "monthly_rent": 1000, "tenant": {"name": "F"}}).json()["id"]
    owner.put("/api/records", headers=H, json={"tenancy_id": tid, "month": "2026-11", "rent_due": 1000,
                                                "rent_paid": 1000})
    r = owner.get("/api/records.csv?year=2026")
    assert r.status_code == 200
    lines = r.text.strip().splitlines()
    assert len(lines) == 2 and lines[1].startswith("2026-11,Sky Residence A-12-3,Master room,F")
