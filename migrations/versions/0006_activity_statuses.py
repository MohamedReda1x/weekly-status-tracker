"""Add activity statuses without changing existing data."""
from alembic import op

revision, down_revision = "0006", "0005"

def upgrade():
    op.execute("ALTER TABLE activities DROP CONSTRAINT activities_status_check")
    op.execute("ALTER TABLE activities ADD CONSTRAINT activities_status_check CHECK(status IN ('WIP','Completed','Not started','Stand-by'))")

def downgrade():
    # Fail rather than rewrite activities using the new statuses.
    op.execute("ALTER TABLE activities DROP CONSTRAINT activities_status_check")
    op.execute("ALTER TABLE activities ADD CONSTRAINT activities_status_check CHECK(status IN ('WIP','Completed'))")
