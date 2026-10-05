"""comments can cover several ISO weeks (or be general); history rows keep period/activity links"""
from alembic import op
revision, down_revision = "0002", "0001"

def upgrade():
    op.execute("CREATE TABLE comment_scopes(comment_id INT NOT NULL REFERENCES comments(id) ON DELETE CASCADE, iso_year INT NOT NULL, iso_week INT NOT NULL, PRIMARY KEY(comment_id, iso_year, iso_week))")
    op.execute("CREATE INDEX ix_comment_scopes_week ON comment_scopes(iso_year, iso_week)")
    # existing comments keep their single week as one scope (comments.iso_year/iso_week stay untouched)
    op.execute("INSERT INTO comment_scopes(comment_id, iso_year, iso_week) SELECT id, iso_year, iso_week FROM comments WHERE iso_year IS NOT NULL AND iso_week IS NOT NULL")
    op.execute("ALTER TABLE history ADD COLUMN activity_id INT, ADD COLUMN period_id INT")
    # best-effort backfill of period_id for old cell rows from their text "... WK40 (2026-09)"; activity_id of old rows stays NULL (not reliably recoverable)
    op.execute("""UPDATE history h SET period_id = p.id FROM periods p
                  WHERE h.period_id IS NULL AND h.what ~ 'WK[0-9]+ \\([0-9]{4}-[0-9]{2}\\)'
                    AND p.iso_week = substring(h.what from 'WK([0-9]+) \\(')::int AND p.month_key = substring(h.what from '\\(([0-9]{4}-[0-9]{2})\\)')""")
    op.execute("CREATE INDEX ix_history_period ON history(period_id)")
    op.execute("CREATE INDEX ix_history_activity ON history(activity_id)")
    op.execute("CREATE INDEX ix_comments_created ON comments(tracker_id, id DESC)")

def downgrade():
    # keep V3 compatibility: V3 reads comments.iso_year/iso_week -> fill them from the first scope of new comments
    op.execute("""UPDATE comments c SET iso_year=s.iso_year, iso_week=s.iso_week FROM (SELECT DISTINCT ON (comment_id) comment_id, iso_year, iso_week FROM comment_scopes ORDER BY comment_id, iso_year, iso_week) s WHERE c.id=s.comment_id AND c.iso_year IS NULL""")
    op.execute("DROP INDEX ix_comments_created"); op.execute("DROP INDEX ix_history_activity"); op.execute("DROP INDEX ix_history_period")
    op.execute("ALTER TABLE history DROP COLUMN activity_id, DROP COLUMN period_id")
    op.execute("DROP TABLE comment_scopes")
