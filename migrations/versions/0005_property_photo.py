"""property photo

Revision ID: 0005_property_photo
Revises: 0004_unit_position
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_property_photo"
down_revision = "0004_unit_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("photo_version", sa.Integer(), nullable=True))
    op.create_table(
        "property_photos",
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("mime", sa.String(length=24), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("property_photos")
    op.drop_column("properties", "photo_version")
