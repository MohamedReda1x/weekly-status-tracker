"""Recoverable activity deletion; entries and history are preserved."""
from alembic import op
revision, down_revision = "0005", "0004"

def upgrade():
    op.execute("ALTER TABLE activities ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))")

def downgrade():
    # Dropping the flag would silently include deleted work in totals again.
    op.execute("DO $$ BEGIN IF EXISTS(SELECT 1 FROM activities WHERE deleted=1) THEN RAISE EXCEPTION 'Restore deleted activities through the application before downgrading'; END IF; END $$")
    op.execute("ALTER TABLE activities DROP COLUMN deleted")
