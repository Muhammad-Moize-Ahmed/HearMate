"""Plain-text emails for the auth flows."""

from ...providers.email import EmailMessage


def verification_code(to: str, first_name: str, code: str, ttl_minutes: int) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Your HearMate verification code",
        body=(
            f"Hi {first_name},\n\n"
            f"Your HearMate verification code is {code}. It expires in {ttl_minutes} minutes.\n\n"
            "If you didn't create a HearMate account, you can ignore this email."
        ),
    )


def account_already_exists(to: str, first_name: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="You already have a HearMate account",
        body=(
            f"Hi {first_name},\n\n"
            "Someone tried to sign up for HearMate with this email address, but an account "
            "already exists. You can sign in, or reset your password if you've forgotten it.\n\n"
            "If this wasn't you, you can ignore this email."
        ),
    )


def password_reset_code(to: str, first_name: str, code: str, ttl_minutes: int) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Your HearMate password reset code",
        body=(
            f"Hi {first_name},\n\n"
            f"Your password reset code is {code}. It expires in {ttl_minutes} minutes.\n\n"
            "If you didn't ask to reset your password, you can ignore this email; "
            "your password won't change."
        ),
    )


def therapist_decision(
    to: str, first_name: str, *, approved: bool, reason: str | None
) -> EmailMessage:
    if approved:
        return EmailMessage(
            to=to,
            subject="Your HearMate therapist account is approved",
            body=(
                f"Hi {first_name},\n\n"
                "Your therapist account has been approved. Parents can now invite you to "
                "follow their child's progress."
            ),
        )
    return EmailMessage(
        to=to,
        subject="Your HearMate therapist application",
        body=(
            f"Hi {first_name},\n\n"
            "We couldn't approve your therapist account."
            + (f"\n\nReason: {reason}" if reason else "")
        ),
    )
