from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Setting(SQLModel, table=True):
    __tablename__ = "settings"
    key: str = Field(primary_key=True)
    value: str


class Search(SQLModel, table=True):
    __tablename__ = "searches"
    id: int | None = Field(default=None, primary_key=True)
    raw_query: str
    translated_query: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    pdf_only: int = 0
    is_saved: int = 0
    stage: str = "new"  # new|translating|searching|fetched|screening|ready|error
    stage_detail: str | None = None  # JSON
    clarifications: str | None = None  # JSON [{"question": ..., "answer": ...}], accumulated
    refined_question: str | None = None  # raw_query restated with the clarified details folded in
    created_at: str = Field(default_factory=utcnow)


class Paper(SQLModel, table=True):
    __tablename__ = "papers"
    id: int | None = Field(default=None, primary_key=True)
    pmid: str | None = Field(default=None, sa_column_kwargs={"unique": True})
    doi: str | None = Field(default=None, sa_column_kwargs={"unique": True})
    title: str
    authors: str | None = None
    journal: str | None = None
    year: int | None = None
    pub_date: str | None = None
    abstract: str | None = None
    url: str | None = None
    pdf_url: str | None = None
    pmcid: str | None = None
    fetched_at: str = Field(default_factory=utcnow)


class Triage(SQLModel, table=True):
    __tablename__ = "triage"
    paper_id: int = Field(primary_key=True, foreign_key="papers.id")
    relevant: int
    finding: str | None = None
    design: str | None = None
    n: int | None = None
    followup: str | None = None
    weakness: str | None = None
    strengths: str | None = None  # JSON array
    score: int | None = None
    peer_reviewed: int | None = None
    randomised: int | None = None
    masked: int | None = None
    model_used: str | None = None
    raw_json: str | None = None
    created_at: str = Field(default_factory=utcnow)


class SearchResult(SQLModel, table=True):
    __tablename__ = "search_results"
    search_id: int = Field(primary_key=True, foreign_key="searches.id")
    paper_id: int = Field(primary_key=True, foreign_key="papers.id")
    rank: int | None = None
    status: str = "pending"  # pending|kept|skipped
    source: str = "search"  # search|explore
    decided_at: str | None = None


class Note(SQLModel, table=True):
    __tablename__ = "notes"
    id: int | None = Field(default=None, primary_key=True)
    search_id: int | None = Field(default=None, foreign_key="searches.id")
    title: str | None = None
    body_md: str
    paper_ids: str  # JSON array
    created_at: str = Field(default_factory=utcnow)


