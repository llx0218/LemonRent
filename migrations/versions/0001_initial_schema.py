"""initial schema

Revision ID: 4b66ae401726
Revises: 
Create Date: 2026-11-18 19:09:23.001630

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4b66ae401726'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:

    op.create_table('login_throttle',
    sa.Column('key', sa.String(length=320), nullable=False),
    sa.Column('failures', sa.Integer(), nullable=False),
    sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=80), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('totp_secret_enc', sa.Text(), nullable=True),
    sa.Column('totp_enabled', sa.Boolean(), nullable=False),
    sa.Column('disabled', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('audit_log',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('ts', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actor_id', sa.Integer(), nullable=True),
    sa.Column('actor_label', sa.String(length=80), nullable=False),
    sa.Column('action', sa.String(length=200), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('invites',
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('note', sa.String(length=120), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_by', sa.Integer(), nullable=True),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['used_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('code')
    )
    op.create_table('properties',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('address', sa.String(length=300), nullable=False),
    sa.Column('purchase_date', sa.Date(), nullable=True),
    sa.Column('purchase_price', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('down_payment', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('upfront_costs', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('loan_amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('current_value', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_properties_owner_id'), 'properties', ['owner_id'], unique=False)
    op.create_table('tenants',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('phone', sa.String(length=40), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('id_number_enc', sa.Text(), nullable=True),
    sa.Column('occupation', sa.String(length=120), nullable=False),
    sa.Column('emergency_contact', sa.String(length=200), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tenants_owner_id'), 'tenants', ['owner_id'], unique=False)
    op.create_table('web_sessions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('user_agent', sa.String(length=300), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_web_sessions_user_id'), 'web_sessions', ['user_id'], unique=False)
    op.create_table('commitments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('property_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('frequency', sa.String(length=8), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.ForeignKeyConstraint(['property_id'], ['properties.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_commitments_property_id'), 'commitments', ['property_id'], unique=False)
    op.create_table('expenses',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('property_id', sa.Integer(), nullable=False),
    sa.Column('spent_on', sa.Date(), nullable=False),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('note', sa.String(length=300), nullable=False),
    sa.ForeignKeyConstraint(['property_id'], ['properties.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_expenses_property_id'), 'expenses', ['property_id'], unique=False)
    op.create_table('units',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('property_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('target_rent', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['property_id'], ['properties.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_units_property_id'), 'units', ['property_id'], unique=False)
    op.create_table('tenancies',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('unit_id', sa.Integer(), nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('monthly_rent', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('rent_due_day', sa.Integer(), nullable=False),
    sa.Column('security_deposit', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('utility_deposit', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('deposit_returned', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('utilities_mode', sa.String(length=16), nullable=False),
    sa.Column('moved_out_on', sa.Date(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['unit_id'], ['units.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tenancies_tenant_id'), 'tenancies', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_tenancies_unit_id'), 'tenancies', ['unit_id'], unique=False)
    op.create_table('monthly_records',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tenancy_id', sa.Integer(), nullable=False),
    sa.Column('month', sa.Date(), nullable=False),
    sa.Column('rent_due', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('rent_paid', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('paid_on', sa.Date(), nullable=True),
    sa.Column('electricity', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('water', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('internet', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('other_utility', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('utilities_paid', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('method', sa.String(length=24), nullable=False),
    sa.Column('note', sa.String(length=300), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenancy_id'], ['tenancies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenancy_id', 'month', name='uq_record_month')
    )
    op.create_index(op.f('ix_monthly_records_tenancy_id'), 'monthly_records', ['tenancy_id'], unique=False)



def downgrade() -> None:

    op.drop_index(op.f('ix_monthly_records_tenancy_id'), table_name='monthly_records')
    op.drop_table('monthly_records')
    op.drop_index(op.f('ix_tenancies_unit_id'), table_name='tenancies')
    op.drop_index(op.f('ix_tenancies_tenant_id'), table_name='tenancies')
    op.drop_table('tenancies')
    op.drop_index(op.f('ix_units_property_id'), table_name='units')
    op.drop_table('units')
    op.drop_index(op.f('ix_expenses_property_id'), table_name='expenses')
    op.drop_table('expenses')
    op.drop_index(op.f('ix_commitments_property_id'), table_name='commitments')
    op.drop_table('commitments')
    op.drop_index(op.f('ix_web_sessions_user_id'), table_name='web_sessions')
    op.drop_table('web_sessions')
    op.drop_index(op.f('ix_tenants_owner_id'), table_name='tenants')
    op.drop_table('tenants')
    op.drop_index(op.f('ix_properties_owner_id'), table_name='properties')
    op.drop_table('properties')
    op.drop_table('invites')
    op.drop_table('audit_log')
    op.drop_table('users')
    op.drop_table('login_throttle')

