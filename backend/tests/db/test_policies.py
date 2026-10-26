"""The access matrix for children's data."""

import uuid

import pytest
from sqlalchemy.orm import Session

from app.auth.deps import require_approved_therapist
from app.auth.policies import (
    can_edit_child,
    can_manage_plan,
    can_view_child,
    get_editable_child,
    get_plan_managed_child,
    get_viewable_child,
)
from app.auth.principal import Principal, PrincipalKind
from app.core.errors import NotFoundError, PermissionDeniedError
from app.db.models import Child, TherapistApprovalStatus, TherapistLinkStatus, User, UserRole
from tests.factories import link_therapist, make_child, make_therapist, make_user


def as_principal(user: User, *, approved: bool = True) -> Principal:
    return Principal(
        kind=PrincipalKind(user.role.value),
        id=user.id,
        therapist_approved=approved and user.role is UserRole.THERAPIST,
    )


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent)


def test_parents_see_and_edit_only_their_own_children(
    db_session: Session, parent: User, child: Child
) -> None:
    other_parent = make_user(db_session)
    owner = as_principal(parent)
    stranger = as_principal(other_parent)

    assert can_view_child(db_session, owner, child)
    assert can_edit_child(owner, child)
    assert not can_view_child(db_session, stranger, child)
    assert not can_edit_child(stranger, child)


def test_children_see_only_themselves_and_edit_nothing(
    db_session: Session, parent: User, child: Child
) -> None:
    sibling = make_child(db_session, parent)
    me = Principal(kind=PrincipalKind.CHILD, id=child.id)

    assert can_view_child(db_session, me, child)
    assert not can_view_child(db_session, me, sibling)
    assert not can_edit_child(me, child)


@pytest.mark.parametrize(
    ("approved", "link_status", "expected"),
    [
        (True, TherapistLinkStatus.ACTIVE, True),
        (True, TherapistLinkStatus.PENDING, False),
        (True, TherapistLinkStatus.REVOKED, False),
        (True, None, False),
        (False, TherapistLinkStatus.ACTIVE, False),  # not yet approved by an admin
    ],
)
def test_therapists_need_approval_and_an_active_link(
    db_session: Session,
    child: Child,
    approved: bool,
    link_status: TherapistLinkStatus | None,
    expected: bool,
) -> None:
    status = TherapistApprovalStatus.APPROVED if approved else TherapistApprovalStatus.PENDING
    therapist = make_therapist(db_session, status=status)
    if link_status is not None:
        link_therapist(db_session, therapist, child, link_status)
    principal = Principal(
        kind=PrincipalKind.THERAPIST,
        id=therapist.id,
        therapist_approved=approved,  # gitleaks:allow
    )

    assert can_view_child(db_session, principal, child) is expected
    assert can_manage_plan(db_session, principal, child) is expected
    assert not can_edit_child(principal, child)


def test_admins_get_no_access_to_childrens_data(db_session: Session, child: Child) -> None:
    admin = make_user(db_session, role=UserRole.ADMIN)

    assert not can_view_child(db_session, as_principal(admin), child)


def test_parents_cannot_manage_learning_plans(
    db_session: Session, parent: User, child: Child
) -> None:
    assert not can_manage_plan(db_session, as_principal(parent), child)


def test_invisible_children_are_reported_as_not_found(db_session: Session, child: Child) -> None:
    stranger = as_principal(make_user(db_session))

    with pytest.raises(NotFoundError):
        get_viewable_child(db_session, stranger, child.id)


def test_visible_but_not_editable_is_forbidden(db_session: Session, child: Child) -> None:
    therapist = make_therapist(db_session)
    link_therapist(db_session, therapist, child)
    principal = as_principal(therapist)

    assert get_viewable_child(db_session, principal, child.id) == child
    assert get_plan_managed_child(db_session, principal, child.id) == child
    with pytest.raises(PermissionDeniedError):
        get_editable_child(db_session, principal, child.id)


def test_parents_can_view_but_not_manage_plans(
    db_session: Session, parent: User, child: Child
) -> None:
    assert get_editable_child(db_session, as_principal(parent), child.id) == child
    with pytest.raises(PermissionDeniedError):
        get_plan_managed_child(db_session, as_principal(parent), child.id)


def test_require_approved_therapist() -> None:
    approved = Principal(kind=PrincipalKind.THERAPIST, id=uuid.uuid4(), therapist_approved=True)
    pending = Principal(kind=PrincipalKind.THERAPIST, id=uuid.uuid4())
    parent = Principal(kind=PrincipalKind.PARENT, id=uuid.uuid4())

    assert require_approved_therapist(approved) is approved
    with pytest.raises(PermissionDeniedError) as excinfo:
        require_approved_therapist(pending)
    assert excinfo.value.code == "therapist_not_approved"
    with pytest.raises(PermissionDeniedError):
        require_approved_therapist(parent)
