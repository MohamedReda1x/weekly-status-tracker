import os
from alembic import context
from sqlalchemy import create_engine
url = os.environ.get("DATABASE_URL", "postgresql://tracker:tracker@localhost:5432/tracker").replace("postgresql://", "postgresql+psycopg://", 1)
with create_engine(url).begin() as conn:
    context.configure(connection=conn, target_metadata=None)
    with context.begin_transaction(): context.run_migrations()
