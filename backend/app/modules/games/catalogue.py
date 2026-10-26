"""Keeps the `games` table in step with the code registry (run: python -m app.cli sync-games)."""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models import Game
from .content import load_bank
from .definitions import REGISTRY


@dataclass
class SyncReport:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    deactivated: list[str] = field(default_factory=list)


def sync_games(db: Session) -> SyncReport:
    """Insert or update a row per registered game; deactivate rows whose code is gone.

    An admin's `is_active = false` on a registered game is preserved.
    """
    report = SyncReport()
    existing = {g.slug: g for g in db.scalars(select(Game))}
    content_version = load_bank().version

    for slug, definition in REGISTRY.items():
        values = {
            "title": definition.title,
            "category": definition.category,
            "description": definition.description,
            "icon": definition.icon,
            "sort_order": definition.sort_order,
            "requires_microphone": definition.requires_microphone,
            "config": {"content_version": content_version},
        }
        game = existing.get(slug)
        if game is None:
            db.add(Game(slug=slug, is_active=True, **values))
            report.created.append(slug)
            continue
        changed = [k for k, v in values.items() if getattr(game, k) != v]
        for key in changed:
            setattr(game, key, values[key])
        if changed:
            report.updated.append(slug)

    for slug, game in existing.items():
        if slug not in REGISTRY and game.is_active:
            game.is_active = False
            report.deactivated.append(slug)

    db.commit()
    return report
