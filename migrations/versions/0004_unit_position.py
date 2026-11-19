"""unit display order

Revision ID: 0004_unit_position
Revises: 0003_receipts_admin_fee
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_unit_position"
down_revision = "0003_receipts_admin_fee"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("units", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE units SET position = id")


def downgrade() -> None:
    op.drop_column("units", "position")
