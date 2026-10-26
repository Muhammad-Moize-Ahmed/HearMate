import uuid
from dataclasses import dataclass
from enum import StrEnum

from ..db.models import UserRole


class PrincipalKind(StrEnum):
    PARENT = "parent"
    THERAPIST = "therapist"
    ADMIN = "admin"
    CHILD = "child"


USER_KINDS = frozenset({PrincipalKind.PARENT, PrincipalKind.THERAPIST, PrincipalKind.ADMIN})


def kind_for_role(role: UserRole) -> PrincipalKind:
    return PrincipalKind(role.value)


@dataclass(frozen=True, slots=True)
class Principal:
    """Who is making the request. Built only by `get_principal`, from a verified token + DB row."""

    kind: PrincipalKind
    id: uuid.UUID
    therapist_approved: bool = False

    @property
    def is_child(self) -> bool:
        return self.kind is PrincipalKind.CHILD
