"""Plain-text emails sent after a deletion. Counts only: no child's name.

Subjects never contain a name, because a failed send is logged by its subject (`send_safely`).
These messages live only in the request's outbox (memory) until they are sent.
"""

from ...providers.email import EmailMessage


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def parent_account_deleted(to: str, first_name: str, *, children: int) -> EmailMessage:
    profiles = _plural(children, "child profile", "child profiles")
    return EmailMessage(
        to=to,
        subject="Your HearMate account was deleted",
        body=(
            f"Hi {first_name},\n\n"
            f"Your HearMate account and {profiles} were deleted, as you asked. Their games, "
            "progress, badges, goals, notes and learning plans were deleted too, and every "
            "device was signed out. This can't be undone.\n\n"
            "If you didn't do this, someone knew your password: please sign up again and use "
            "a new password."
        ),
    )


def therapist_account_deleted(to: str, first_name: str, *, linked_children: int) -> EmailMessage:
    families = _plural(linked_children, "child", "children")
    return EmailMessage(
        to=to,
        subject="Your HearMate therapist account was deleted",
        body=(
            f"Hi {first_name},\n\n"
            f"Your HearMate therapist account was deleted, as you asked. Your access to "
            f"{families} and any invitations you had have ended, and every device was signed "
            "out. The notes and learning plans you wrote stay with each child's record, shown "
            "as written by a former therapist. This can't be undone.\n\n"
            "If you didn't do this, someone knew your password."
        ),
    )


def child_deleted(to: str, first_name: str, *, remaining: int) -> EmailMessage:
    left = _plural(remaining, "child profile", "child profiles")
    return EmailMessage(
        to=to,
        subject="A child profile was deleted from your HearMate account",
        body=(
            f"Hi {first_name},\n\n"
            "A child profile was deleted from your HearMate account, as you asked, with all of "
            "its games, progress, badges, goals, notes and learning plans. That child was "
            f"signed out everywhere. You now have {left}. This can't be undone.\n\n"
            "If you didn't do this, someone knew your password: please change it."
        ),
    )


def therapist_left(to: str, first_name: str, *, therapist_name: str, children: int) -> EmailMessage:
    whose = "your child's" if children == 1 else f"{children} of your children's"
    return EmailMessage(
        to=to,
        subject="A therapist left your child's care team",
        body=(
            f"Hi {first_name},\n\n"
            f"{therapist_name} deleted their HearMate therapist account, so they no longer have "
            f"access to {whose} records, and any invitation to them has ended. The notes and "
            "learning plans they wrote are still on the child's page, shown as written by a "
            "former therapist.\n\n"
            "You can invite another therapist from the child's page at any time."
        ),
    )
