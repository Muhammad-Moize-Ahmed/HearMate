"""Deleting an account (parent or therapist) or one child: immediate and permanent.

The password is asked for again. Emails are collected in `outbox` and sent by the router only
after the transaction commits; they are never stored.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...auth.policies import get_editable_child
from ...auth.principal import Principal, PrincipalKind
from ...core.config import Settings
from ...core.errors import AuthenticationError
from ...db.models import Child, User
from ...providers.email import EmailMessage
from ..auth.service import AuthService
from . import emails, purge
from .schemas import DeletionSummaryOut, ParentDeletionSummaryOut, TherapistDeletionSummaryOut


class AccountService:
    def __init__(
        self, db: Session, settings: Settings, principal: Principal, *, client_ip: str | None
    ) -> None:
        self.db = db
        self.settings = settings
        self.principal = principal
        self.client_ip = client_ip
        self.outbox: list[EmailMessage] = []

    def deletion_summary(self) -> DeletionSummaryOut:
        if self.principal.kind is PrincipalKind.THERAPIST:
            t = purge.therapist_counts(self.db, self.principal.id)
            return TherapistDeletionSummaryOut(
                role="therapist",
                linked_children=t.linked_children,
                notes=t.notes,
                learning_plans=t.learning_plans,
            )
        f = purge.family_counts(self.db, self.principal.id)
        return ParentDeletionSummaryOut(
            role="parent", children=f.children, games_played=f.games_played, therapists=f.therapists
        )

    def delete_account(self, password: str) -> None:
        """Parent: the whole family. Therapist: their account; their notes and plans stay."""
        user = self._confirmed_user(password)
        email, first_name = user.email, user.first_name
        if self.principal.kind is PrincipalKind.THERAPIST:
            name = f"{user.first_name} {user.last_name}".strip()
            parents = purge.linked_parents(self.db, user.id)
            counts = purge.delete_therapist(self.db, user)
            self.outbox.append(
                emails.therapist_account_deleted(
                    email, first_name, linked_children=counts.linked_children
                )
            )
            # The name goes into these messages only; nothing about it is written anywhere.
            self.outbox += [
                emails.therapist_left(
                    p.email, p.first_name, therapist_name=name, children=p.children
                )
                for p in parents
            ]
        else:
            children = purge.delete_family(self.db, user)
            self.outbox.append(emails.parent_account_deleted(email, first_name, children=children))
        self.db.commit()

    def delete_child(self, child_id: uuid.UUID, password: str) -> None:
        """One of the parent's children, with all of their data. The parent's account stays."""
        child = get_editable_child(self.db, self.principal, child_id)
        parent = self._confirmed_user(password)
        purge.delete_child(self.db, child, parent_id=parent.id, ip=self.client_ip)
        remaining = self.db.scalar(
            select(func.count()).select_from(Child).where(Child.parent_id == parent.id)
        )
        self.outbox.append(
            emails.child_deleted(parent.email, parent.first_name, remaining=remaining or 0)
        )
        self.db.commit()

    def _confirmed_user(self, password: str) -> User:
        # Locked, so two deletions (or a deletion and a login) can't interleave.
        user = self.db.get(User, self.principal.id, with_for_update=True, populate_existing=True)
        if user is None:
            raise AuthenticationError("Account no longer available", code="invalid_token")
        AuthService(self.db, self.settings, client_ip=self.client_ip).confirm_password(
            user, password
        )
        return user
