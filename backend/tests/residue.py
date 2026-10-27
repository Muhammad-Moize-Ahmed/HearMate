"""Look for any trace of someone in the database: every row of every table, read as text.

Used after a deletion to prove that nothing about the deleted person is left: not their id
(wherever it is kept, foreign key or not), email, names, usernames or IP addresses.
"""

from collections.abc import Iterable

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db import models  # noqa: F401 - registers every table on Base.metadata
from app.db.base import Base


def traces(db: Session, needles: Iterable[object]) -> list[tuple[str, str]]:
    """(table, needle) for each row that contains a needle anywhere, ignoring case."""
    wanted = sorted({str(n).lower() for n in needles if n})
    found: list[tuple[str, str]] = []
    for table in Base.metadata.sorted_tables:
        # Table names come from the models, never from input.
        query = text(f'SELECT CAST(t AS text) FROM "{table.name}" t')  # noqa: S608
        rows = db.execute(query).scalars()
        for row in rows:
            lower = row.lower()
            found += [(table.name, needle) for needle in wanted if needle in lower]
    return found


def row_counts(db: Session) -> dict[str, int]:
    return {
        table.name: db.scalar(select(func.count()).select_from(table)) or 0
        for table in Base.metadata.sorted_tables
    }


def grown(before: dict[str, int], after: dict[str, int]) -> set[str]:
    """The tables that gained rows."""
    return {name for name, count in after.items() if count > before[name]}
