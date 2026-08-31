import os
from pathlib import Path

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

BASE_DIR = Path(__file__).resolve().parents[2]  # sift/
DATA_DIR = Path(os.environ.get("SIFT_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "sift.db"

engine = create_engine(
    f"sqlite:///{DB_PATH.as_posix()}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


def session() -> Session:
    return Session(engine)


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(engine)
    _migrate()


def _migrate() -> None:
    """Additive column migrations for databases created before a model change."""
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(papers)")}
        if "pmcid" not in cols:
            conn.exec_driver_sql("ALTER TABLE papers ADD COLUMN pmcid TEXT")
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(searches)")}
        if "clarifications" not in cols:
            conn.exec_driver_sql("ALTER TABLE searches ADD COLUMN clarifications TEXT")
        if "refined_question" not in cols:
            conn.exec_driver_sql("ALTER TABLE searches ADD COLUMN refined_question TEXT")
        conn.commit()
