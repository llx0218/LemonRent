"""Cashflow and return calculations. Pure: works on loaded ORM objects and a
given "today", with no database or clock access of its own.

Money is attributed to the billing month it belongs to, not the day it was
paid. Yearly commitments are spread evenly over twelve months. Actual returns
use completed months only, so a half-collected current month does not drag
them down.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable, Optional

from .models import DEPOSIT_KINDS, Commitment, MonthlyRecord, Property, Tenancy

ZERO = Decimal("0")
MYT = timezone(timedelta(hours=8))


def today_myt() -> date:
    return datetime.now(MYT).date()


def month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def add_months(m: date, n: int) -> date:
    k = m.year * 12 + (m.month - 1) + n
    return date(k // 12, k % 12 + 1, 1)


def month_range(first: date, last: date) -> list[date]:
    out, m = [], month_start(first)
    last = month_start(last)
    while m <= last:
        out.append(m)
        m = add_months(m, 1)
    return out


def parse_month(text: Optional[str], default: date) -> date:
    if not text:
        return month_start(default)
    y, m = text.split("-")[:2]
    return date(int(y), int(m), 1)


def d(x) -> Decimal:
    return ZERO if x is None else Decimal(x)


def f(x: Optional[Decimal]) -> Optional[float]:
    return None if x is None else float(round(Decimal(x), 2))


def pct(num: Decimal, den: Decimal) -> Optional[float]:
    if not den:
        return None
    return float(round(num * 100 / den, 2))


def tenancy_active_in(t: Tenancy, m: date) -> bool:
    if month_start(t.start_date) > m:
        return False
    return t.last_day is None or month_start(t.last_day) >= m


def tenancy_active_on(t: Tenancy, day: date) -> bool:
    return t.start_date <= day and (t.last_day is None or t.last_day >= day)


def utility_bills(r: MonthlyRecord) -> Decimal:
    return d(r.electricity) + d(r.water) + d(r.internet) + d(r.other_utility)


def utilities_due(r: MonthlyRecord, mode: str) -> Decimal:
    return utility_bills(r) if mode == "charged" else ZERO


def utility_cost(r: MonthlyRecord, mode: str) -> Decimal:
    return ZERO if mode == "tenant_direct" else utility_bills(r)


def commitment_monthly(c: Commitment) -> Decimal:
    amt = d(c.amount)
    return amt / 12 if c.frequency == "yearly" else amt


def commitment_active_in(c: Commitment, m: date) -> bool:
    if c.start_date and month_start(c.start_date) > m:
        return False
    return c.end_date is None or month_start(c.end_date) >= m


def property_tenancies(p: Property) -> list[Tenancy]:
    return [t for u in p.units for t in u.tenancies]


def property_start(p: Property, today: date) -> date:
    if p.purchase_date:
        return month_start(p.purchase_date)
    candidates = [t.start_date for t in property_tenancies(p)]
    candidates += [c.start_date for c in p.commitments if c.start_date]
    candidates += [e.spent_on for e in p.expenses]
    candidates += [rc.received_on for t in property_tenancies(p) for rc in t.receipts]
    return month_start(min(candidates)) if candidates else month_start(today)


@dataclass
class MonthFlow:
    month: date
    rent_expected: Decimal = ZERO
    rent_in: Decimal = ZERO
    utilities_in: Decimal = ZERO
    fees_in: Decimal = ZERO
    utilities_cost: Decimal = ZERO
    commitments: Decimal = ZERO
    expenses: Decimal = ZERO

    @property
    def income(self) -> Decimal:
        return self.rent_in + self.utilities_in + self.fees_in

    @property
    def outgo(self) -> Decimal:
        return self.utilities_cost + self.commitments + self.expenses

    @property
    def net(self) -> Decimal:
        return self.income - self.outgo

    def add(self, o: "MonthFlow") -> None:
        self.rent_expected += o.rent_expected
        self.rent_in += o.rent_in
        self.utilities_in += o.utilities_in
        self.fees_in += o.fees_in
        self.utilities_cost += o.utilities_cost
        self.commitments += o.commitments
        self.expenses += o.expenses

    def as_dict(self) -> dict:
        return {"month": self.month.strftime("%Y-%m"), "rent_expected": f(self.rent_expected),
                "rent_in": f(self.rent_in), "utilities_in": f(self.utilities_in),
                "fees_in": f(self.fees_in), "utilities_cost": f(self.utilities_cost), "commitments": f(self.commitments),
                "expenses": f(self.expenses), "income": f(self.income), "outgo": f(self.outgo),
                "net": f(self.net)}


def property_flows(p: Property, months: Iterable[date], today: date) -> list[MonthFlow]:
    start = property_start(p, today)
    tenancies = property_tenancies(p)
    by_month: dict[date, list[tuple[Tenancy, MonthlyRecord]]] = {}
    for t in tenancies:
        for r in t.records:
            by_month.setdefault(r.month, []).append((t, r))
    fees_by_month: dict[date, Decimal] = {}
    for t in tenancies:
        for rc in t.receipts:
            if not rc.is_deposit:
                k = month_start(rc.received_on)
                fees_by_month[k] = fees_by_month.get(k, ZERO) + d(rc.amount)
    out = []
    for m in months:
        mf = MonthFlow(month=m, fees_in=fees_by_month.get(m, ZERO))
        recorded = set()
        for t, r in by_month.get(m, []):
            recorded.add(t.id)
            mf.rent_expected += d(r.rent_due)
            mf.rent_in += d(r.rent_paid)
            mf.utilities_in += d(r.utilities_paid)
            mf.utilities_cost += utility_cost(r, t.utilities_mode)
        for t in tenancies:
            if t.id not in recorded and tenancy_active_in(t, m):
                mf.rent_expected += d(t.monthly_rent)
        if m >= start:
            mf.commitments = sum((commitment_monthly(c) for c in p.commitments
                                  if commitment_active_in(c, m)), ZERO)
        mf.expenses = sum((d(e.amount) for e in p.expenses if month_start(e.spent_on) == m), ZERO)
        out.append(mf)
    return out


def month_detail(p: Property, m: date, today: date) -> dict:
    tenancies = property_tenancies(p)
    income, outgo, deposits, unpaid = [], [], [], []
    recorded = set()
    for t in tenancies:
        who = f"{t.tenant.name} · {t.unit.name}"
        for r in t.records:
            if r.month != m:
                continue
            recorded.add(t.id)
            if d(r.rent_paid) > 0:
                income.append({"kind": "rent", "label": "Rent", "who": who, "amount": d(r.rent_paid),
                               "date": r.paid_on, "tenant_id": t.tenant_id})
            if d(r.utilities_paid) > 0:
                income.append({"kind": "utilities", "label": "Utilities paid back", "who": who,
                               "amount": d(r.utilities_paid), "date": r.paid_on, "tenant_id": t.tenant_id})
            cost = utility_cost(r, t.utilities_mode)
            if cost > 0:
                outgo.append({"kind": "utilities", "label": "Utility bills", "who": t.unit.name, "amount": cost})
            owed = d(r.rent_due) + utilities_due(r, t.utilities_mode) - d(r.rent_paid) - d(r.utilities_paid)
            if owed > Decimal("0.004"):
                unpaid.append({"who": who, "amount": owed, "entered": True, "tenant_id": t.tenant_id,
                               "tenancy_id": t.id})
        for rc in t.receipts:
            if month_start(rc.received_on) != m:
                continue
            item = {"kind": rc.kind, "label": rc.kind.replace("_", " ").capitalize(), "who": who,
                    "amount": d(rc.amount), "date": rc.received_on, "tenant_id": t.tenant_id}
            (deposits if rc.is_deposit else income).append(item)
        if t.id not in recorded and tenancy_active_in(t, m):
            unpaid.append({"who": who, "amount": d(t.monthly_rent), "entered": False, "tenant_id": t.tenant_id,
                           "tenancy_id": t.id})
    if m >= property_start(p, today):
        for c in p.commitments:
            if commitment_active_in(c, m):
                outgo.append({"kind": "commitment", "label": c.name, "who": "Yearly, per month"
                              if c.frequency == "yearly" else "", "amount": commitment_monthly(c)})
    for e in p.expenses:
        if month_start(e.spent_on) == m:
            outgo.append({"kind": "expense", "label": e.category, "who": e.note or "", "amount": d(e.amount),
                          "date": e.spent_on})
    return {"income": income, "outgo": outgo, "deposits": deposits, "unpaid": unpaid}


@dataclass
class Balance:
    due: Decimal = ZERO
    paid: Decimal = ZERO
    overdue: Decimal = ZERO
    overdue_months: list = field(default_factory=list)
    unrecorded_months: list = field(default_factory=list)

    @property
    def outstanding(self) -> Decimal:
        return self.due - self.paid


def tenancy_balance(t: Tenancy, today: date) -> Balance:
    current = month_start(today)
    records = {r.month: r for r in t.records}
    last = month_start(t.last_day) if t.last_day else current
    months = set(month_range(t.start_date, min(last, current))) | set(records)
    b = Balance()
    for m in sorted(months):
        r = records.get(m)
        if r is not None:
            due = d(r.rent_due) + utilities_due(r, t.utilities_mode)
            paid = d(r.rent_paid) + d(r.utilities_paid)
        else:
            due, paid = d(t.monthly_rent), ZERO
            b.unrecorded_months.append(m.strftime("%Y-%m"))
        b.due += due
        b.paid += paid
        if m < current and due > paid:
            b.overdue += due - paid
            b.overdue_months.append(m.strftime("%Y-%m"))
    return b


def property_stats(p: Property, today: date) -> dict:
    current = month_start(today)
    start = property_start(p, today)
    last_done = add_months(current, -1)
    all_months = month_range(start, last_done) if start <= last_done else []
    flows = property_flows(p, all_months, today)
    last12 = flows[-12:]

    to_date = MonthFlow(month=current)
    for mf in flows:
        to_date.add(mf)
    year = MonthFlow(month=current)
    for mf in last12:
        year.add(mf)

    cash_invested = d(p.down_payment) + d(p.upfront_costs)
    n = len(last12)
    annual_net = year.net * 12 / n if n else ZERO

    tenancies = property_tenancies(p)
    live = [t for t in tenancies if tenancy_active_on(t, today)]
    rent_now = sum((d(t.monthly_rent) for t in live), ZERO)
    commit_now = sum((commitment_monthly(c) for c in p.commitments if commitment_active_in(c, current)), ZERO)
    commit_loan = sum((commitment_monthly(c) for c in p.commitments
                       if c.kind == "loan" and commitment_active_in(c, current)), ZERO)
    expected_net = rent_now - commit_now
    price = d(p.purchase_price)
    appreciation = (d(p.current_value) - price) if p.current_value is not None else None

    active_units = [u for u in p.units if u.active]
    occupied = {t.unit_id for t in live}
    arrears = sum((tenancy_balance(t, today).overdue for t in tenancies), ZERO)
    held = sum((deposit_summary(t)["held"] for t in tenancies), ZERO)

    return {
        "cash_invested": f(cash_invested),
        "months_owned": len(all_months),
        "rent_now": f(rent_now),
        "target_rent": f(sum((d(u.target_rent) for u in active_units), ZERO)),
        "commitment_monthly": f(commit_now),
        "commitment_loan_monthly": f(commit_loan),
        "expected_net_monthly": f(expected_net),
        "gross_yield_pct": pct(rent_now * 12, price),
        "net_yield_pct": pct((rent_now - (commit_now - commit_loan)) * 12, price),
        "projected_cash_on_cash_pct": pct(expected_net * 12, cash_invested),
        "cash_on_cash_pct": pct(annual_net, cash_invested),
        "last12": {"months": n, "income": f(year.income), "outgo": f(year.outgo), "net": f(year.net),
                   "annualised_net": f(annual_net)},
        "to_date": {"income": f(to_date.income), "outgo": f(to_date.outgo), "net": f(to_date.net),
                    "rent_in": f(to_date.rent_in), "commitments": f(to_date.commitments),
                    "expenses": f(to_date.expenses), "utilities_cost": f(to_date.utilities_cost),
                    "utilities_in": f(to_date.utilities_in), "fees_in": f(to_date.fees_in)},
        "payback_pct": pct(to_date.net, cash_invested),
        "appreciation": f(appreciation),
        "total_return_pct": pct(to_date.net + (appreciation or ZERO), cash_invested)
        if appreciation is not None else None,
        "units_active": len(active_units),
        "units_occupied": len([u for u in active_units if u.id in occupied]),
        "arrears": f(arrears),
        "deposits_held": f(held),
    }


def portfolio(props: list[Property], today: date, months: int = 12) -> dict:
    current = month_start(today)
    window = [add_months(current, -k) for k in range(months - 1, -1, -1)]
    series = [MonthFlow(month=m) for m in window]
    for p in props:
        for agg, mf in zip(series, property_flows(p, window, today)):
            agg.add(mf)
    stats = [property_stats(p, today) for p in props]

    def total(key: str) -> Decimal:
        return sum((Decimal(str(s[key] or 0)) for s in stats), ZERO)

    cash = total("cash_invested")
    net12 = sum((Decimal(str(s["last12"]["annualised_net"] or 0)) for s in stats), ZERO)
    net_to_date = sum((Decimal(str(s["to_date"]["net"] or 0)) for s in stats), ZERO)
    expected = total("expected_net_monthly")
    price = sum((d(p.purchase_price) for p in props), ZERO)
    rent_now = total("rent_now")
    commit = total("commitment_monthly")
    loan = total("commitment_loan_monthly")
    return {
        "series": [mf.as_dict() for mf in series],
        "cash_invested": f(cash),
        "rent_now": f(rent_now),
        "commitment_monthly": f(commit),
        "expected_net_monthly": f(expected),
        "cash_on_cash_pct": pct(net12, cash),
        "projected_cash_on_cash_pct": pct(expected * 12, cash),
        "gross_yield_pct": pct(rent_now * 12, price),
        "net_yield_pct": pct((rent_now - (commit - loan)) * 12, price),
        "net_to_date": f(net_to_date),
        "payback_pct": pct(net_to_date, cash),
        "units_active": int(total("units_active")),
        "units_occupied": int(total("units_occupied")),
        "arrears": f(total("arrears")),
        "deposits_held": f(total("deposits_held")),
    }


def deposit_summary(t: Tenancy) -> dict:
    """Deposits agreed on the tenancy against what was actually received.
    held is what is still with the owner after any refund at move-out."""
    agreed = {k: d(getattr(t, k)) for k in DEPOSIT_KINDS}
    collected = {k: ZERO for k in DEPOSIT_KINDS}
    for rc in t.receipts:
        if rc.is_deposit:
            collected[rc.kind] += d(rc.amount)
    total_collected = sum(collected.values(), ZERO)
    return {
        "agreed": agreed, "collected": collected,
        "total_agreed": sum(agreed.values(), ZERO), "total_collected": total_collected,
        "pending": {k: max(ZERO, agreed[k] - collected[k]) for k in DEPOSIT_KINDS},
        "held": max(ZERO, total_collected - d(t.deposit_returned)),
    }


def fees_summary(t: Tenancy) -> dict:
    admin = sum((d(rc.amount) for rc in t.receipts if rc.kind == "admin_fee"), ZERO)
    other = sum((d(rc.amount) for rc in t.receipts if rc.kind == "other_fee"), ZERO)
    return {"admin_fee_agreed": d(t.admin_fee), "admin_fee_collected": admin,
            "admin_fee_pending": max(ZERO, d(t.admin_fee) - admin), "other_fees_collected": other}
