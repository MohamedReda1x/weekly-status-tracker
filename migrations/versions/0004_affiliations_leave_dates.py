"""Employee affiliations and informational leave dates; existing data is preserved."""
from alembic import op
revision, down_revision = "0004", "0003"

def upgrade():
    op.execute("CREATE TABLE trades(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL)")
    op.execute("CREATE TABLE professional_roles(id SERIAL PRIMARY KEY, trade_id INT NOT NULL REFERENCES trades(id), name TEXT NOT NULL, UNIQUE(trade_id,name), UNIQUE(id,trade_id))")
    op.execute("CREATE TABLE clients(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL)")
    op.execute("ALTER TABLE users ADD COLUMN trade_id INT REFERENCES trades(id), ADD COLUMN professional_role_id INT, ADD COLUMN client_id INT REFERENCES clients(id)")
    op.execute("ALTER TABLE users ADD CONSTRAINT user_professional_role_trade FOREIGN KEY(professional_role_id,trade_id) REFERENCES professional_roles(id,trade_id)")
    op.execute("ALTER TABLE users ADD CONSTRAINT user_role_requires_trade CHECK(professional_role_id IS NULL OR trade_id IS NOT NULL)")
    op.execute("CREATE TABLE leave_dates(tracker_id INT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE, period_id INT NOT NULL REFERENCES periods(id), leave_date DATE NOT NULL, PRIMARY KEY(tracker_id,period_id,leave_date))")
    op.execute("INSERT INTO trades(name) VALUES('Train Control'),('Train System')")
    for trade, roles in (("Train Control", ("VTE","CE","SDE","SwQA")), ("Train System", ("SE","Sub-SE","RM"))):
        for role in roles:
            op.execute("INSERT INTO professional_roles(trade_id,name) SELECT id,'" + role + "' FROM trades WHERE name='" + trade + "'")
    op.execute("INSERT INTO clients(name) VALUES('Alstom Petite-Forêt')")

def downgrade():
    # Explicit downgrade removes ONLY the new feature data; application rollback needs none.
    op.execute("DROP TABLE leave_dates")
    op.execute("ALTER TABLE users DROP CONSTRAINT user_professional_role_trade, DROP CONSTRAINT user_role_requires_trade")
    op.execute("ALTER TABLE users DROP COLUMN professional_role_id, DROP COLUMN trade_id, DROP COLUMN client_id")
    for table in ("professional_roles", "trades", "clients"):
        op.execute("DROP TABLE " + table)
