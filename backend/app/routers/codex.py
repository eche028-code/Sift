"""The Codex tag vocabulary — dropped in as a file, or pasted from the phone."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import codex

router = APIRouter(prefix="/api/codex", tags=["codex"])


class TaxonomyIn(BaseModel):
    yaml_text: str


class DirIn(BaseModel):
    path: str


@router.get("/export-dir")
def get_export_dir() -> dict:
    configured = codex.export_dir()
    path = str(configured) if configured else ""
    return {"path": path, **codex.check_dir(path)}


@router.post("/export-dir/check")
def check_export_dir(body: DirIn) -> dict:
    """Check a path the reader has typed but not saved yet — writes a probe file."""
    return {"path": body.path.strip(), **codex.check_dir(body.path, probe=True)}


@router.get("/taxonomy")
def get_taxonomy() -> dict:
    tags = codex.load_taxonomy()
    return {"tags": tags, "count": len(tags), "path": str(codex.TAXONOMY_PATH)}


@router.put("/taxonomy")
def put_taxonomy(body: TaxonomyIn) -> dict:
    try:
        tags = codex.save_taxonomy(body.yaml_text)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except OSError as e:
        raise HTTPException(500, f"could not write {codex.TAXONOMY_PATH}: {e}")
    return {"tags": tags, "count": len(tags), "path": str(codex.TAXONOMY_PATH)}
