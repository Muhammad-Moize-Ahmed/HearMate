from pydantic import BaseModel, ConfigDict


class InputModel(BaseModel):
    """Base for request bodies: unknown fields are an error, not silently dropped."""

    model_config = ConfigDict(extra="forbid")
