from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
import os

def _resolve_database_url() -> str:
    raw_url = os.getenv("O11Y_DB_URL", "sqlite:///./o11y_server.db")
    if not raw_url.startswith("sqlite:///"):
        return raw_url

    sqlite_path = raw_url.replace("sqlite:///", "", 1)
    db_path = Path(sqlite_path)
    if not db_path.is_absolute():
        project_root = Path(__file__).resolve().parents[2]
        db_path = (project_root / db_path).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path}"

DATABASE_URL = _resolve_database_url()

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite:///"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    engine_kwargs["poolclass"] = NullPool

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """Dependency to get a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
