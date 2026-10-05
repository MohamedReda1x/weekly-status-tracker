"""forced password change flag; trackers.client becomes optional (field no longer used by the UI)"""
from alembic import op
revision, down_revision = "0003", "0002"

def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE trackers ALTER COLUMN client DROP NOT NULL")   # old values are kept, never deleted

def downgrade():
    op.execute("UPDATE trackers SET client='' WHERE client IS NULL")
    op.execute("ALTER TABLE trackers ALTER COLUMN client SET NOT NULL")
    op.execute("ALTER TABLE users DROP COLUMN must_change_password")
