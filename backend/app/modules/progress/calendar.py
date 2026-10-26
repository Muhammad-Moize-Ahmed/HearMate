"""Local days and streaks. A child's day follows their time zone, not UTC."""

from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from ...core.config import Settings
from ...db.models import Child


def child_zone(child: Child, settings: Settings) -> ZoneInfo:
    return ZoneInfo(child.timezone or settings.DEFAULT_TIMEZONE)


def local_date(moment: datetime, zone: ZoneInfo) -> date:
    return moment.astimezone(zone).date()


def start_of_day(day: date, zone: ZoneInfo) -> datetime:
    """The UTC instant a local day begins (handles DST changes)."""
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)


def current_streak(play_dates: Iterable[date], today: date) -> int:
    """Consecutive days played, ending today, or yesterday if today isn't played yet."""
    days = set(play_dates)
    day = today if today in days else today - timedelta(days=1)
    streak = 0
    while day in days:
        streak += 1
        day -= timedelta(days=1)
    return streak


def longest_streak(play_dates: Iterable[date]) -> int:
    best = run = 0
    previous: date | None = None
    for day in sorted(set(play_dates)):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return best
