"""deposit and fee receipts; admin fee on tenancies

Existing tenancies get one receipt per deposit already on file, dated the
lease start, so deposits held stay the same after the upgrade.

Revision ID: 0003_receipts_admin_fee
Revises: 0002_access_card_deposit
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_receipts_admin_fee"
down_revision = "0002_access_card_deposit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenancies", sa.Column("admin_fee", sa.Numeric(precision=12, scale=2),
                                         nullable=False, server_default="0"))
    op.create_table(
        "tenancy_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenancy_id", sa.Integer(), sa.ForeignKey("tenancies.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("method", sa.String(length=24), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_tenancy_receipts_tenancy_id", "tenancy_receipts", ["tenancy_id"])
    for col in ("security_deposit", "utility_deposit", "access_card_deposit"):
        op.execute(
            "INSERT INTO tenancy_receipts (tenancy_id, kind, amount, received_on, method, note) "
            f"SELECT id, '{col}', {col}, start_date, '', 'Carried over from the tenancy record' "
            f"FROM tenancies WHERE {col} > 0"
        )


def downgrade() -> None:
    op.drop_index("ix_tenancy_receipts_tenancy_id", table_name="tenancy_receipts")
    op.drop_table("tenancy_receipts")
    op.drop_column("tenancies", "admin_fee")
