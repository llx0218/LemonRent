"""access card deposit on tenancies

Revision ID: 0002_access_card_deposit
Revises: 4b66ae401726
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_access_card_deposit"
down_revision = "4b66ae401726"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenancies", sa.Column("access_card_deposit", sa.Numeric(precision=12, scale=2),
                                         nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("tenancies", "access_card_deposit")
