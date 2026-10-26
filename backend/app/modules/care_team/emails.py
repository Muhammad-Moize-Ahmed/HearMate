from ...providers.email import EmailMessage


def therapist_invited(
    to: str, therapist_name: str, parent_name: str, child_name: str
) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject=f"{parent_name} invited you to follow {child_name} on HearMate",
        body=(
            f"Hi {therapist_name},\n\n"
            f"{parent_name} has invited you to follow {child_name}'s progress on HearMate.\n"
            "Sign in to accept or decline the invitation."
        ),
    )


def invitation_accepted(
    to: str, parent_name: str, therapist_name: str, child_name: str
) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject=f"{therapist_name} is now following {child_name} on HearMate",
        body=(
            f"Hi {parent_name},\n\n"
            f"{therapist_name} accepted your invitation and can now see {child_name}'s progress "
            "and set a learning plan. You can remove their access at any time."
        ),
    )
