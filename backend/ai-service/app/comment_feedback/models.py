from pydantic import BaseModel, Field, field_validator


class FeedbackInput(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def require_comment(cls, text: str) -> str:
        """Content의 댓글 본문과 같이 공백·NUL·UTF-16 길이를 검사한다."""
        text = text.strip()
        if not text or "\x00" in text or len(text.encode("utf-16-le")) > 1000:
            raise ValueError("댓글은 1~500 UTF-16 단위여야 하며 NUL을 포함할 수 없습니다.")
        return text


class FeedbackOutput(BaseModel):
    feedbackProbability: float = Field(ge=0, le=1)
    isFeedback: bool
    modelVersion: str
    threshold: float


class BatchItem(FeedbackInput):
    id: str = Field(min_length=1, max_length=64)


class BatchInput(BaseModel):
    items: list[BatchItem] = Field(min_length=1, max_length=32)

    @field_validator("items")
    @classmethod
    def unique_ids(cls, items):
        if len({item.id for item in items}) != len(items):
            raise ValueError("중복 댓글 ID")
        return items


class PrimaryOutput(FeedbackOutput):
    id: str
    primaryAspect: str | None
    aspectVersion: str
