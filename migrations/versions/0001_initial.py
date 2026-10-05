"""initial schema"""
from alembic import op
revision, down_revision = "0001", None
SQL = """
CREATE TABLE users(id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','employee')), pw TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE sessions(h TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, exp DOUBLE PRECISION NOT NULL);
CREATE TABLE tokens(h TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, exp DOUBLE PRECISION NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE emails(id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE SET NULL, to_addr TEXT, subject TEXT, body TEXT, status TEXT, error TEXT, created TEXT);
CREATE TABLE trackers(id SERIAL PRIMARY KEY, owner_id INT UNIQUE NOT NULL REFERENCES users(id), client TEXT NOT NULL, work_package TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL, end_date TEXT);
CREATE TABLE periods(id SERIAL PRIMARY KEY, p_start TEXT UNIQUE NOT NULL, p_end TEXT NOT NULL, month_key TEXT NOT NULL, iso_year INT NOT NULL, iso_week INT NOT NULL, capacity INT NOT NULL CHECK(capacity>0));
CREATE TABLE activities(id SERIAL PRIMARY KEY, tracker_id INT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE, pos INT NOT NULL, affected TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', deliverables TEXT NOT NULL DEFAULT '', estimation TEXT NOT NULL DEFAULT '', progress INT NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100), status TEXT NOT NULL DEFAULT 'WIP' CHECK(status IN ('WIP','Completed')), archived INT NOT NULL DEFAULT 0);
CREATE TABLE entries(activity_id INT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, period_id INT NOT NULL REFERENCES periods(id), milli INT NOT NULL CHECK(milli>0), PRIMARY KEY(activity_id, period_id));
CREATE TABLE info(tracker_id INT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE, period_id INT NOT NULL REFERENCES periods(id), kind TEXT NOT NULL, milli INT NOT NULL, PRIMARY KEY(tracker_id, period_id, kind));
CREATE TABLE comments(id SERIAL PRIMARY KEY, tracker_id INT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE, author_id INT NOT NULL REFERENCES users(id), iso_year INT, iso_week INT, text TEXT NOT NULL, created TEXT, batch TEXT);
CREATE TABLE history(id SERIAL PRIMARY KEY, batch TEXT, tracker_id INT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE, author_id INT NOT NULL REFERENCES users(id), at TEXT, what TEXT, old TEXT, new TEXT);
CREATE INDEX ix_entries_period ON entries(period_id);
CREATE INDEX ix_comments_tracker ON comments(tracker_id);
CREATE INDEX ix_history_tracker ON history(tracker_id);
"""
def upgrade():
    for stmt in SQL.strip().split(";\n"):
        if stmt.strip(): op.execute(stmt)
def downgrade():
    for t in ("history","comments","info","entries","activities","periods","trackers","emails","tokens","sessions","users"): op.execute(f"DROP TABLE {t}")
