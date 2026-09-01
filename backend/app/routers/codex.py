"""The Codex tag vocabulary — dropped in as a file, or pasted from the phone."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import codex

router = APIRouter(prefix="/api/codex", tags=["codex"])


class TaxonomyIn(BaseModel):
    yaml_text: str


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
