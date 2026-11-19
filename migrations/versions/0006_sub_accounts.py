"""sub-accounts and invite ownership

Revision ID: 0006_sub_accounts
Revises: 0005_property_photo
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_sub_accounts"
down_revision = "0005_property_photo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_users_parent_id", "users", ["parent_id"], ["id"], ondelete="CASCADE")
        b.create_index("ix_users_parent_id", ["parent_id"])
    with op.batch_alter_table("invites") as b:
        b.add_column(sa.Column("created_by", sa.Integer(), nullable=True))
        b.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_invites_created_by", "users", ["created_by"], ["id"], ondelete="SET NULL")
        b.create_foreign_key("fk_invites_parent_id", "users", ["parent_id"], ["id"], ondelete="CASCADE")


def downgrade() -> None:
    with op.batch_alter_table("invites") as b:
        b.drop_constraint("fk_invites_parent_id", type_="foreignkey")
        b.drop_constraint("fk_invites_created_by", type_="foreignkey")
        b.drop_column("parent_id")
        b.drop_column("created_by")
    with op.batch_alter_table("users") as b:
        b.drop_index("ix_users_parent_id")
        b.drop_constraint("fk_users_parent_id", type_="foreignkey")
        b.drop_column("parent_id")
