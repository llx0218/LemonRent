"""Properties, units, commitments, expenses, tenants, tenancies and the
monthly rent and utilities records. Every row is scoped to its owner."""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import finance as fin
from ..crypto import decrypt, encrypt
from ..db import get_session, utcnow
from ..models import (Commitment, Expense, MonthlyRecord, Property, Tenancy, Tenant, Unit, User)
from ..services import audit
from .auth import client_ip, user_any

router = APIRouter(prefix="/api")

Money = Field(default=Decimal("0"), ge=0, le=Decimal("9999999999"))
OptMoney = Field(default=None, ge=0, le=Decimal("9999999999"))
UtilMode = Literal["charged", "included", "tenant_direct"]


def _load_props(s: Session, user: User, pid: Optional[int] = None) -> list[Property]:
    q = select(Property).where(Property.owner_id == user.id).order_by(Property.id)
    if pid is not None:
        q = q.where(Property.id == pid)
    q = (q
         .options(selectinload(Property.units).selectinload(Unit.tenancies).selectinload(Tenancy.records),
                  selectinload(Property.units).selectinload(Unit.tenancies).selectinload(Tenancy.tenant),
                  selectinload(Property.commitments), selectinload(Property.expenses)))
    return list(s.scalars(q))


def _prop(s: Session, user: User, pid: int) -> Property:
    p = s.get(Property, pid)
    if p is None or p.owner_id != user.id:
        raise HTTPException(404, "Property not found")
    return p


def _unit(s: Session, user: User, uid: int) -> Unit:
    u = s.get(Unit, uid)
    if u is None or u.property.owner_id != user.id:
        raise HTTPException(404, "Unit not found")
    return u


def _tenant(s: Session, user: User, tid: int) -> Tenant:
    t = s.get(Tenant, tid)
    if t is None or t.owner_id != user.id:
        raise HTTPException(404, "Tenant not found")
    return t


def _tenancy(s: Session, user: User, tid: int) -> Tenancy:
    t = s.get(Tenancy, tid)
    if t is None or t.unit.property.owner_id != user.id:
        raise HTTPException(404, "Tenancy not found")
    return t


def _ds(x: Optional[date]) -> Optional[str]:
    return x.isoformat() if x else None


def _mask(enc: Optional[str]) -> str:
    if not enc:
        return ""
    plain = decrypt(enc)
    return ("•" * max(0, len(plain) - 4)) + plain[-4:]


def tenancy_status(t: Tenancy, today: date) -> str:
    if t.start_date > today:
        return "upcoming"
    if t.last_day is not None and t.last_day < today:
        return "ended"
    return "active"


def tenancy_dict(t: Tenancy, today: date, with_records: bool = False) -> dict:
    b = fin.tenancy_balance(t, today)
    out = {
        "id": t.id, "unit_id": t.unit_id, "unit_name": t.unit.name,
        "property_id": t.unit.property_id, "property_name": t.unit.property.name,
        "tenant_id": t.tenant_id, "tenant_name": t.tenant.name, "tenant_phone": t.tenant.phone,
        "start_date": _ds(t.start_date), "end_date": _ds(t.end_date), "moved_out_on": _ds(t.moved_out_on),
        "monthly_rent": fin.f(t.monthly_rent), "rent_due_day": t.rent_due_day,
        "security_deposit": fin.f(t.security_deposit), "utility_deposit": fin.f(t.utility_deposit),
        "access_card_deposit": fin.f(t.access_card_deposit),
        "deposit_returned": fin.f(t.deposit_returned), "utilities_mode": t.utilities_mode,
        "notes": t.notes, "status": tenancy_status(t, today),
        "days_left": (t.end_date - today).days if t.end_date and not t.moved_out_on else None,
        "balance": {"due": fin.f(b.due), "paid": fin.f(b.paid), "outstanding": fin.f(b.outstanding),
                    "overdue": fin.f(b.overdue), "overdue_months": b.overdue_months,
                    "unrecorded_months": b.unrecorded_months},
    }
    if with_records:
        out["records"] = [record_dict(r, t) for r in reversed(t.records)]
    return out


def record_dict(r: MonthlyRecord, t: Tenancy) -> dict:
    return {
        "id": r.id, "tenancy_id": r.tenancy_id, "month": r.month.strftime("%Y-%m"),
        "rent_due": fin.f(r.rent_due), "rent_paid": fin.f(r.rent_paid), "paid_on": _ds(r.paid_on),
        "electricity": fin.f(r.electricity), "water": fin.f(r.water), "internet": fin.f(r.internet),
        "other_utility": fin.f(r.other_utility), "utilities_paid": fin.f(r.utilities_paid),
        "utility_bills": fin.f(fin.utility_bills(r)),
        "utilities_due": fin.f(fin.utilities_due(r, t.utilities_mode)),
        "method": r.method, "note": r.note,
    }


def unit_dict(u: Unit, today: date) -> dict:
    current = next((t for t in u.tenancies if fin.tenancy_active_on(t, today)), None)
    upcoming = next((t for t in sorted(u.tenancies, key=lambda x: x.start_date)
                     if t.start_date > today), None)
    return {"id": u.id, "property_id": u.property_id, "property_name": u.property.name,
            "name": u.name, "target_rent": fin.f(u.target_rent), "active": u.active, "notes": u.notes,
            "current": tenancy_dict(current, today) if current else None,
            "upcoming": tenancy_dict(upcoming, today) if upcoming else None,
            "tenancy_count": len(u.tenancies)}


def commitment_dict(c: Commitment) -> dict:
    return {"id": c.id, "name": c.name, "kind": c.kind, "amount": fin.f(c.amount),
            "frequency": c.frequency, "monthly": fin.f(fin.commitment_monthly(c)),
            "start_date": _ds(c.start_date), "end_date": _ds(c.end_date)}


def expense_dict(e: Expense) -> dict:
    return {"id": e.id, "spent_on": _ds(e.spent_on), "category": e.category,
            "amount": fin.f(e.amount), "note": e.note}


def property_dict(p: Property, today: date, detail: bool = False) -> dict:
    out = {
        "id": p.id, "name": p.name, "address": p.address, "purchase_date": _ds(p.purchase_date),
        "purchase_price": fin.f(p.purchase_price), "down_payment": fin.f(p.down_payment),
        "upfront_costs": fin.f(p.upfront_costs), "loan_amount": fin.f(p.loan_amount),
        "current_value": fin.f(p.current_value), "notes": p.notes,
        "stats": fin.property_stats(p, today),
    }
    if detail:
        cur = fin.month_start(today)
        window = [fin.add_months(cur, -k) for k in range(11, -1, -1)]
        out["units"] = [unit_dict(u, today) for u in p.units]
        out["commitments"] = [commitment_dict(c) for c in p.commitments]
        out["expenses"] = [expense_dict(e) for e in p.expenses]
        out["series"] = [mf.as_dict() for mf in fin.property_flows(p, window, today)]
    else:
        out["units"] = [{"id": u.id, "name": u.name, "active": u.active,
                         "occupied": any(fin.tenancy_active_on(t, today) for t in u.tenancies)}
                        for u in p.units]
    return out


@router.get("/overview")
def overview(month: Optional[str] = None, user: User = Depends(user_any),
             s: Session = Depends(get_session)):
    today = fin.today_myt()
    m = fin.parse_month(month, today)
    props = _load_props(s, user)
    port = fin.portfolio(props, today)
    tenancies = [t for p in props for t in fin.property_tenancies(p)]

    expected = collected = Decimal("0")
    for t in tenancies:
        rec = next((r for r in t.records if r.month == m), None)
        if rec is not None:
            expected += fin.d(rec.rent_due) + fin.utilities_due(rec, t.utilities_mode)
            collected += fin.d(rec.rent_paid) + fin.d(rec.utilities_paid)
        elif fin.tenancy_active_in(t, m):
            expected += fin.d(t.monthly_rent)

    owing = []
    for t in tenancies:
        b = fin.tenancy_balance(t, today)
        if b.outstanding > 0:
            owing.append({"tenancy_id": t.id, "tenant_id": t.tenant_id, "tenant_name": t.tenant.name,
                          "unit_name": t.unit.name, "property_name": t.unit.property.name,
                          "outstanding": fin.f(b.outstanding), "overdue": fin.f(b.overdue),
                          "overdue_months": b.overdue_months})
    owing.sort(key=lambda x: -(x["overdue"] or 0))

    ending = [tenancy_dict(t, today) for t in tenancies
              if t.end_date and not t.moved_out_on and today <= t.end_date <= today + timedelta(days=60)]
    ending.sort(key=lambda x: x["end_date"])
    vacant = [{"id": u.id, "name": u.name, "property_name": p.name, "target_rent": fin.f(u.target_rent)}
              for p in props for u in p.units
              if u.active and not any(fin.tenancy_active_on(t, today) for t in u.tenancies)]

    return {
        "month": m.strftime("%Y-%m"), "today": today.isoformat(),
        "portfolio": port,
        "month_expected": fin.f(expected), "month_collected": fin.f(collected),
        "owing": owing, "ending_soon": ending, "vacant": vacant,
        "properties": [{"id": p.id, "name": p.name, "stats": fin.property_stats(p, today)} for p in props],
    }


class UnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    target_rent: Decimal = Money
    active: bool = True
    notes: str = Field(default="", max_length=2000)


class CommitmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["loan", "fee", "other"] = "fee"
    amount: Decimal = Money
    frequency: Literal["monthly", "yearly"] = "monthly"
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ExpenseIn(BaseModel):
    spent_on: date
    category: str = Field(default="Repair", min_length=1, max_length=32)
    amount: Decimal = Money
    note: str = Field(default="", max_length=300)


class PropertyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=300)
    purchase_date: Optional[date] = None
    purchase_price: Decimal = Money
    down_payment: Decimal = Money
    upfront_costs: Decimal = Money
    loan_amount: Decimal = Money
    current_value: Optional[Decimal] = OptMoney
    notes: str = Field(default="", max_length=4000)


class PropertyCreate(PropertyIn):
    units: list[UnitIn] = Field(default_factory=list, max_length=50)
    commitments: list[CommitmentIn] = Field(default_factory=list, max_length=30)


@router.get("/properties")
def list_properties(user: User = Depends(user_any), s: Session = Depends(get_session)):
    today = fin.today_myt()
    return [property_dict(p, today) for p in _load_props(s, user)]


@router.post("/properties")
def create_property(body: PropertyCreate, request: Request, user: User = Depends(user_any),
                    s: Session = Depends(get_session)):
    data = body.model_dump(exclude={"units", "commitments"})
    p = Property(owner_id=user.id, **data)
    units = body.units or [UnitIn(name="Whole unit")]
    p.units = [Unit(**u.model_dump()) for u in units]
    p.commitments = [Commitment(**c.model_dump()) for c in body.commitments]
    for c in p.commitments:
        if c.start_date is None:
            c.start_date = p.purchase_date
    s.add(p)
    s.flush()
    audit(s, f"Added property {p.name}", user, client_ip(request))
    return {"id": p.id}


@router.get("/properties/{pid}")
def get_property(pid: int, user: User = Depends(user_any), s: Session = Depends(get_session)):
    found = _load_props(s, user, pid)
    if not found:
        raise HTTPException(404, "Property not found")
    p = found[0]
    return property_dict(p, fin.today_myt(), detail=True)


@router.put("/properties/{pid}")
def update_property(pid: int, body: PropertyIn, user: User = Depends(user_any),
                    s: Session = Depends(get_session)):
    p = _prop(s, user, pid)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    return {"ok": True}


@router.delete("/properties/{pid}")
def delete_property(pid: int, request: Request, user: User = Depends(user_any),
                    s: Session = Depends(get_session)):
    p = _prop(s, user, pid)
    audit(s, f"Deleted property {p.name}", user, client_ip(request))
    s.delete(p)
    return {"ok": True}


@router.get("/units")
def list_units(user: User = Depends(user_any), s: Session = Depends(get_session)):
    today = fin.today_myt()
    return [unit_dict(u, today) for p in _load_props(s, user) for u in p.units]


@router.post("/properties/{pid}/units")
def add_unit(pid: int, body: UnitIn, user: User = Depends(user_any), s: Session = Depends(get_session)):
    p = _prop(s, user, pid)
    u = Unit(property_id=p.id, **body.model_dump())
    s.add(u)
    s.flush()
    return {"id": u.id}


@router.put("/units/{uid}")
def update_unit(uid: int, body: UnitIn, user: User = Depends(user_any), s: Session = Depends(get_session)):
    u = _unit(s, user, uid)
    for k, v in body.model_dump().items():
        setattr(u, k, v)
    return {"ok": True}


@router.delete("/units/{uid}")
def delete_unit(uid: int, user: User = Depends(user_any), s: Session = Depends(get_session)):
    u = _unit(s, user, uid)
    if u.tenancies:
        raise HTTPException(400, "This unit has tenancy history. Mark it inactive instead, so the "
                                 "history and returns stay correct.")
    s.delete(u)
    return {"ok": True}


@router.post("/properties/{pid}/commitments")
def add_commitment(pid: int, body: CommitmentIn, user: User = Depends(user_any),
                   s: Session = Depends(get_session)):
    p = _prop(s, user, pid)
    c = Commitment(property_id=p.id, **body.model_dump())
    if c.start_date is None:
        c.start_date = p.purchase_date
    s.add(c)
    s.flush()
    return {"id": c.id}


@router.put("/commitments/{cid}")
def update_commitment(cid: int, body: CommitmentIn, user: User = Depends(user_any),
                      s: Session = Depends(get_session)):
    c = s.get(Commitment, cid)
    if c is None or c.property.owner_id != user.id:
        raise HTTPException(404, "Commitment not found")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    return {"ok": True}


@router.delete("/commitments/{cid}")
def delete_commitment(cid: int, user: User = Depends(user_any), s: Session = Depends(get_session)):
    c = s.get(Commitment, cid)
    if c is None or c.property.owner_id != user.id:
        raise HTTPException(404, "Commitment not found")
    s.delete(c)
    return {"ok": True}


@router.post("/properties/{pid}/expenses")
def add_expense(pid: int, body: ExpenseIn, user: User = Depends(user_any),
                s: Session = Depends(get_session)):
    p = _prop(s, user, pid)
    e = Expense(property_id=p.id, **body.model_dump())
    s.add(e)
    s.flush()
    return {"id": e.id}


@router.put("/expenses/{eid}")
def update_expense(eid: int, body: ExpenseIn, user: User = Depends(user_any),
                   s: Session = Depends(get_session)):
    e = s.get(Expense, eid)
    if e is None or e.property.owner_id != user.id:
        raise HTTPException(404, "Expense not found")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    return {"ok": True}


@router.delete("/expenses/{eid}")
def delete_expense(eid: int, user: User = Depends(user_any), s: Session = Depends(get_session)):
    e = s.get(Expense, eid)
    if e is None or e.property.owner_id != user.id:
        raise HTTPException(404, "Expense not found")
    s.delete(e)
    return {"ok": True}


class TenantIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=255)
    id_number: Optional[str] = Field(default=None, max_length=40)
    occupation: str = Field(default="", max_length=120)
    emergency_contact: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=4000)


def _apply_tenant(t: Tenant, body: TenantIn) -> None:
    data = body.model_dump(exclude={"id_number"})
    for k, v in data.items():
        setattr(t, k, v.strip() if isinstance(v, str) else v)
    if body.id_number is not None:
        idn = body.id_number.strip()
        t.id_number_enc = encrypt(idn) if idn else None


def tenant_dict(t: Tenant, today: date, detail: bool = False) -> dict:
    tenancies = sorted(t.tenancies, key=lambda x: x.start_date, reverse=True)
    current = next((x for x in tenancies if tenancy_status(x, today) in ("active", "upcoming")), None)
    outstanding = sum((fin.tenancy_balance(x, today).outstanding for x in tenancies), Decimal("0"))
    out = {
        "id": t.id, "name": t.name, "phone": t.phone, "email": t.email,
        "id_number_masked": _mask(t.id_number_enc), "occupation": t.occupation,
        "emergency_contact": t.emergency_contact, "notes": t.notes,
        "current": tenancy_dict(current, today) if current else None,
        "status": tenancy_status(current, today) if current else ("past" if tenancies else "none"),
        "outstanding": fin.f(outstanding),
    }
    if detail:
        out["id_number"] = decrypt(t.id_number_enc) if t.id_number_enc else ""
        out["tenancies"] = [tenancy_dict(x, today, with_records=True) for x in tenancies]
    return out


def _load_tenants(s: Session, user: User) -> list[Tenant]:
    q = (select(Tenant).where(Tenant.owner_id == user.id).order_by(Tenant.name)
         .options(selectinload(Tenant.tenancies).selectinload(Tenancy.records),
                  selectinload(Tenant.tenancies).selectinload(Tenancy.unit).selectinload(Unit.property)))
    return list(s.scalars(q))


@router.get("/tenants")
def list_tenants(user: User = Depends(user_any), s: Session = Depends(get_session)):
    today = fin.today_myt()
    return [tenant_dict(t, today) for t in _load_tenants(s, user)]


@router.post("/tenants")
def create_tenant(body: TenantIn, user: User = Depends(user_any), s: Session = Depends(get_session)):
    t = Tenant(owner_id=user.id, name=body.name)
    _apply_tenant(t, body)
    s.add(t)
    s.flush()
    return {"id": t.id}


@router.get("/tenants/{tid}")
def get_tenant(tid: int, user: User = Depends(user_any), s: Session = Depends(get_session)):
    return tenant_dict(_tenant(s, user, tid), fin.today_myt(), detail=True)


@router.put("/tenants/{tid}")
def update_tenant(tid: int, body: TenantIn, user: User = Depends(user_any),
                  s: Session = Depends(get_session)):
    _apply_tenant(_tenant(s, user, tid), body)
    return {"ok": True}


@router.delete("/tenants/{tid}")
def delete_tenant(tid: int, request: Request, user: User = Depends(user_any),
                  s: Session = Depends(get_session)):
    t = _tenant(s, user, tid)
    if t.tenancies:
        raise HTTPException(400, "This tenant has tenancy history. Delete their tenancies first.")
    audit(s, f"Deleted tenant {t.name}", user, client_ip(request))
    s.delete(t)
    return {"ok": True}


class TenancyIn(BaseModel):
    start_date: date
    end_date: Optional[date] = None
    monthly_rent: Decimal = Money
    rent_due_day: int = Field(default=1, ge=1, le=31)
    security_deposit: Decimal = Money
    utility_deposit: Decimal = Money
    access_card_deposit: Decimal = Money
    utilities_mode: UtilMode = "charged"
    moved_out_on: Optional[date] = None
    deposit_returned: Optional[Decimal] = OptMoney
    notes: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def _dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("End date must be after the start date")
        if self.moved_out_on and self.moved_out_on < self.start_date:
            raise ValueError("Move-out date must be after the start date")
        return self


class TenancyCreate(TenancyIn):
    unit_id: int
    tenant_id: Optional[int] = None
    tenant: Optional[TenantIn] = None


def _check_overlap(s: Session, unit: Unit, start: date, last: Optional[date], skip: Optional[int]) -> None:
    for t in unit.tenancies:
        if t.id == skip:
            continue
        a_end = t.last_day or date.max
        b_end = last or date.max
        if t.start_date <= b_end and start <= a_end:
            raise HTTPException(400, f"{unit.name} is already let to {t.tenant.name} from "
                                     f"{t.start_date:%d %b %Y}" +
                                     (f" to {t.last_day:%d %b %Y}" if t.last_day else " (no end date)") +
                                     ". End that tenancy first or pick other dates.")


@router.post("/tenancies")
def create_tenancy(body: TenancyCreate, request: Request, user: User = Depends(user_any),
                   s: Session = Depends(get_session)):
    unit = _unit(s, user, body.unit_id)
    if body.tenant_id:
        tenant = _tenant(s, user, body.tenant_id)
    elif body.tenant:
        tenant = Tenant(owner_id=user.id, name=body.tenant.name)
        _apply_tenant(tenant, body.tenant)
        s.add(tenant)
        s.flush()
    else:
        raise HTTPException(400, "Choose a tenant or add a new one")
    last = body.moved_out_on or body.end_date
    _check_overlap(s, unit, body.start_date, last, None)
    t = Tenancy(unit_id=unit.id, tenant_id=tenant.id,
                **body.model_dump(exclude={"unit_id", "tenant_id", "tenant"}))
    s.add(t)
    s.flush()
    audit(s, f"New tenancy: {tenant.name} in {unit.property.name} / {unit.name}", user, client_ip(request))
    return {"id": t.id, "tenant_id": tenant.id}


@router.put("/tenancies/{tid}")
def update_tenancy(tid: int, body: TenancyIn, user: User = Depends(user_any),
                   s: Session = Depends(get_session)):
    t = _tenancy(s, user, tid)
    _check_overlap(s, t.unit, body.start_date, body.moved_out_on or body.end_date, t.id)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    return {"ok": True}


@router.delete("/tenancies/{tid}")
def delete_tenancy(tid: int, request: Request, user: User = Depends(user_any),
                   s: Session = Depends(get_session)):
    t = _tenancy(s, user, tid)
    audit(s, f"Deleted tenancy of {t.tenant.name} in {t.unit.name}", user, client_ip(request))
    s.delete(t)
    return {"ok": True}


def _balance_before(t: Tenancy, m: date) -> Decimal:
    records = {r.month: r for r in t.records if r.month < m}
    last = fin.month_start(t.last_day) if t.last_day else fin.add_months(m, -1)
    end = min(last, fin.add_months(m, -1))
    months = set(fin.month_range(t.start_date, end)) if fin.month_start(t.start_date) <= end else set()
    months |= set(records)
    total = Decimal("0")
    for mm in months:
        r = records.get(mm)
        if r is not None:
            total += fin.d(r.rent_due) + fin.utilities_due(r, t.utilities_mode) \
                - fin.d(r.rent_paid) - fin.d(r.utilities_paid)
        else:
            total += fin.d(t.monthly_rent)
    return total


@router.get("/collect")
def collect(month: Optional[str] = None, user: User = Depends(user_any),
            s: Session = Depends(get_session)):
    today = fin.today_myt()
    m = fin.parse_month(month, today)
    prev_m = fin.add_months(m, -1)
    rows = []
    for p in _load_props(s, user):
        for u in p.units:
            for t in u.tenancies:
                rec = next((r for r in t.records if r.month == m), None)
                if rec is None and not fin.tenancy_active_in(t, m):
                    continue
                prev = next((r for r in t.records if r.month == prev_m), None)
                rows.append({
                    "tenancy_id": t.id, "tenant_id": t.tenant_id, "tenant_name": t.tenant.name,
                    "tenant_phone": t.tenant.phone, "unit_name": u.name, "property_id": p.id,
                    "property_name": p.name, "monthly_rent": fin.f(t.monthly_rent),
                    "rent_due_day": t.rent_due_day, "utilities_mode": t.utilities_mode,
                    "record": record_dict(rec, t) if rec else None,
                    "previous_balance": fin.f(_balance_before(t, m)),
                    "prev_bills": {"electricity": fin.f(prev.electricity), "water": fin.f(prev.water),
                                   "internet": fin.f(prev.internet),
                                   "other_utility": fin.f(prev.other_utility)} if prev else None,
                })
    return {"month": m.strftime("%Y-%m"), "today": today.isoformat(), "rows": rows}


class RecordIn(BaseModel):
    tenancy_id: int
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    rent_due: Decimal = Money
    rent_paid: Decimal = Money
    paid_on: Optional[date] = None
    electricity: Decimal = Money
    water: Decimal = Money
    internet: Decimal = Money
    other_utility: Decimal = Money
    utilities_paid: Decimal = Money
    method: str = Field(default="", max_length=24)
    note: str = Field(default="", max_length=300)


def _save_record(s: Session, user: User, body: RecordIn) -> dict:
    t = _tenancy(s, user, body.tenancy_id)
    m = fin.parse_month(body.month, fin.today_myt())
    rec = s.scalar(select(MonthlyRecord).where(MonthlyRecord.tenancy_id == t.id, MonthlyRecord.month == m))
    if rec is None:
        rec = MonthlyRecord(tenancy_id=t.id, month=m)
        s.add(rec)
    for k, v in body.model_dump(exclude={"tenancy_id", "month"}).items():
        setattr(rec, k, v)
    rec.updated_at = utcnow()
    s.flush()
    return record_dict(rec, t)


@router.put("/records")
def save_record(body: RecordIn, user: User = Depends(user_any), s: Session = Depends(get_session)):
    return _save_record(s, user, body)


class RecordBatch(BaseModel):
    records: list[RecordIn] = Field(max_length=200)


@router.post("/records/batch")
def save_records(body: RecordBatch, user: User = Depends(user_any), s: Session = Depends(get_session)):
    return [_save_record(s, user, r) for r in body.records]


@router.delete("/records/{rid}")
def delete_record(rid: int, user: User = Depends(user_any), s: Session = Depends(get_session)):
    r = s.get(MonthlyRecord, rid)
    if r is None or r.tenancy.unit.property.owner_id != user.id:
        raise HTTPException(404, "Record not found")
    s.delete(r)
    return {"ok": True}


@router.get("/records.csv")
def records_csv(year: Optional[int] = None, user: User = Depends(user_any),
                s: Session = Depends(get_session)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["month", "property", "unit", "tenant", "rent_due", "rent_paid", "paid_on",
                "electricity", "water", "internet", "other_utility", "utilities_paid", "method", "note"])
    rows = []
    for p in _load_props(s, user):
        for u in p.units:
            for t in u.tenancies:
                for r in t.records:
                    if year and r.month.year != year:
                        continue
                    rows.append((r.month, p.name, u.name, t.tenant.name, r))
    for m, pn, un, tn, r in sorted(rows, key=lambda x: (x[0], x[1], x[2])):
        w.writerow([m.strftime("%Y-%m"), pn, un, tn, r.rent_due, r.rent_paid, _ds(r.paid_on) or "",
                    r.electricity, r.water, r.internet, r.other_utility, r.utilities_paid, r.method, r.note])
    name = f"lemonrent-payments{'-' + str(year) if year else ''}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
