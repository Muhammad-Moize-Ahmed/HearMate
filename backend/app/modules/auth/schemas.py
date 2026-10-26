import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints, model_validator

from ...core.schemas import InputModel
from ...db.models import TherapistApprovalStatus

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 128

Email = Annotated[EmailStr, AfterValidator(str.lower)]
NewPassword = Annotated[
    str, StringConstraints(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
]
# Existing passwords are only length-capped (older accounts may predate a stricter policy).
Password = Annotated[str, StringConstraints(min_length=1, max_length=MAX_PASSWORD_LENGTH)]
Code = Annotated[str, StringConstraints(pattern=r"^\d{6}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None
Username = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=50),
]
Pin = Annotated[str, StringConstraints(pattern=r"^\d{4,8}$")]


class TherapistDetailsIn(InputModel):
    license_number: OptionalText = None
    organization: OptionalText = None
    specialization: OptionalText = None


class SignupIn(InputModel):
    email: Email
    password: NewPassword
    first_name: Name
    last_name: Name
    role: Literal["parent", "therapist"] = "parent"
    therapist: TherapistDetailsIn | None = None

    @model_validator(mode="after")
    def _therapist_details_only_for_therapists(self) -> "SignupIn":
        if self.role == "parent" and self.therapist is not None:
            raise ValueError("therapist details are only accepted when role is 'therapist'")
        return self


class VerifyEmailIn(InputModel):
    email: Email
    password: Password
    code: Code


class EmailIn(InputModel):
    email: Email


class LoginIn(InputModel):
    email: Email
    password: Password


class ChildLoginIn(InputModel):
    username: Username
    pin: Pin


class ResetPasswordIn(InputModel):
    email: Email
    code: Code
    new_password: NewPassword


class MessageOut(BaseModel):
    message: str


class UserMeOut(BaseModel):
    kind: Literal["parent", "therapist", "admin"]
    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    therapist_status: TherapistApprovalStatus | None = None


class ChildMeOut(BaseModel):
    kind: Literal["child"]
    id: uuid.UUID
    display_name: str
    avatar: str


MeOut = Annotated[UserMeOut | ChildMeOut, Field(discriminator="kind")]


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - OAuth token type
    expires_in: int = Field(description="Access token lifetime in seconds")
    principal: MeOut
