"""Database tables.

Timestamps are stored in UTC. Calendar values (purchase date, lease dates,
billing month) are plain dates in Malaysia time. A billing month is stored as
the first day of that month. Money is NUMERIC(12, 2).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .db import Base, utcnow


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


def _ts() -> Mapped[datetime]:
    return mapped_column(UTCDateTime(), default=utcnow, nullable=False)


def _money(default: str = "0", nullable: bool = False):
    return mapped_column(Numeric(12, 2), default=Decimal(default), nullable=nullable)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    totp_secret_enc: Mapped[Optional[str]] = mapped_column(Text)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = _ts()
    last_login_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime())

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class WebSession(Base):
    __tablename__ = "web_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = _ts()
    last_seen_at: Mapped[datetime] = _ts()
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")


class LoginThrottle(Base):
    __tablename__ = "login_throttle"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[Optional[datetime]] = mapped_column(UTCDateTime())
    updated_at: Mapped[datetime] = _ts()


class Invite(Base):
    __tablename__ = "invites"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    note: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    created_at: Mapped[datetime] = _ts()
    used_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    used_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime())
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = _ts()
    actor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str] = mapped_column(String(80), default="System")
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="")


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    address: Mapped[str] = mapped_column(String(300), default="")
    purchase_date: Mapped[Optional[date]] = mapped_column(Date)
    purchase_price: Mapped[Decimal] = _money()
    down_payment: Mapped[Decimal] = _money()
    upfront_costs: Mapped[Decimal] = _money()
    loan_amount: Mapped[Decimal] = _money()
    current_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2))
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()

    units: Mapped[list["Unit"]] = relationship(back_populates="property", cascade="all, delete-orphan",
                                               order_by="Unit.id")
    commitments: Mapped[list["Commitment"]] = relationship(back_populates="property",
                                                           cascade="all, delete-orphan",
                                                           order_by="Commitment.id")
    expenses: Mapped[list["Expense"]] = relationship(back_populates="property",
                                                     cascade="all, delete-orphan",
                                                     order_by="Expense.spent_on.desc()")


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    target_rent: Mapped[Decimal] = _money()
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()

    property: Mapped[Property] = relationship(back_populates="units")
    tenancies: Mapped[list["Tenancy"]] = relationship(back_populates="unit", cascade="all, delete-orphan",
                                                      order_by="Tenancy.start_date.desc()")


class Commitment(Base):
    """A recurring cost of owning the property: loan instalment, maintenance
    fee, sinking fund, insurance, quit rent, assessment, internet."""
    __tablename__ = "commitments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="fee", nullable=False)
    amount: Mapped[Decimal] = _money()
    frequency: Mapped[str] = mapped_column(String(8), default="monthly", nullable=False)
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)

    property: Mapped[Property] = relationship(back_populates="commitments")


class Expense(Base):
    """A one-off cost after purchase: repair, agent fee, new furniture."""
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    spent_on: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="Repair", nullable=False)
    amount: Mapped[Decimal] = _money()
    note: Mapped[str] = mapped_column(String(300), default="")

    property: Mapped[Property] = relationship(back_populates="expenses")


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    id_number_enc: Mapped[Optional[str]] = mapped_column(Text)
    occupation: Mapped[str] = mapped_column(String(120), default="")
    emergency_contact: Mapped[str] = mapped_column(String(200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()

    tenancies: Mapped[list["Tenancy"]] = relationship(back_populates="tenant",
                                                      order_by="Tenancy.start_date.desc()")


class Tenancy(Base):
    """One lease: a tenant in a unit for a period.

    utilities_mode:
      charged       owner pays the bills and collects them back from the tenant
      included      owner pays the bills, rent already covers them
      tenant_direct tenant pays the providers; amounts are kept for reference only
    """
    __tablename__ = "tenancies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="RESTRICT"), index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    monthly_rent: Mapped[Decimal] = _money()
    rent_due_day: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    security_deposit: Mapped[Decimal] = _money()
    utility_deposit: Mapped[Decimal] = _money()
    access_card_deposit: Mapped[Decimal] = _money()
    deposit_returned: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2))
    utilities_mode: Mapped[str] = mapped_column(String(16), default="charged", nullable=False)
    moved_out_on: Mapped[Optional[date]] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()

    unit: Mapped[Unit] = relationship(back_populates="tenancies")
    tenant: Mapped[Tenant] = relationship(back_populates="tenancies")
    records: Mapped[list["MonthlyRecord"]] = relationship(back_populates="tenancy",
                                                          cascade="all, delete-orphan",
                                                          order_by="MonthlyRecord.month")

    @property
    def last_day(self) -> Optional[date]:
        return self.moved_out_on or self.end_date


class MonthlyRecord(Base):
    """What a tenancy owed and paid for one month."""
    __tablename__ = "monthly_records"
    __table_args__ = (UniqueConstraint("tenancy_id", "month", name="uq_record_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenancy_id: Mapped[int] = mapped_column(ForeignKey("tenancies.id", ondelete="CASCADE"), index=True)
    month: Mapped[date] = mapped_column(Date, nullable=False)
    rent_due: Mapped[Decimal] = _money()
    rent_paid: Mapped[Decimal] = _money()
    paid_on: Mapped[Optional[date]] = mapped_column(Date)
    electricity: Mapped[Decimal] = _money()
    water: Mapped[Decimal] = _money()
    internet: Mapped[Decimal] = _money()
    other_utility: Mapped[Decimal] = _money()
    utilities_paid: Mapped[Decimal] = _money()
    method: Mapped[str] = mapped_column(String(24), default="")
    note: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[datetime] = _ts()

    tenancy: Mapped[Tenancy] = relationship(back_populates="records")
