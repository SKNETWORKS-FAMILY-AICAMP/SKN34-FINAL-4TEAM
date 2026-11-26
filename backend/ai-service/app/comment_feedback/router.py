from fastapi import APIRouter, Header, HTTPException, Request

from app import tracing
from app.internal_auth import require_internal_token
from app.comment_feedback.models import FeedbackInput, FeedbackOutput, BatchInput, PrimaryOutput
from app.comment_feedback.service import VERSION, G2_VERSION

router = APIRouter()


@router.post("/internal/v1/comments/feedback", response_model=FeedbackOutput)
def classify_feedback(data: FeedbackInput, request: Request, x_internal_token: str = Header(default=""),
                      x_user_authorization: str = Header(default="")) -> FeedbackOutput:
    """댓글 하나의 피드백 확률과 서비스 판정을 반환한다."""
    require_internal_token(x_internal_token)
    with tracing.request("comment_feedback", user_id=tracing.member_id(x_user_authorization)):
        classifier = request.app.state.feedback_classifier
        if classifier is None:
            raise HTTPException(503, "피드백 분류기를 사용할 수 없습니다.")
        try:
            probability = classifier.probability(data.text)
        except Exception:
            raise HTTPException(503, "피드백 분류에 실패했습니다.") from None
        return FeedbackOutput(feedbackProbability=probability, isFeedback=probability > classifier.threshold,
                              modelVersion=VERSION, threshold=classifier.threshold)


@router.post("/internal/v1/comments/feedback/batch", response_model=list[PrimaryOutput])
def classify_batch(data: BatchInput, request: Request, x_internal_token: str = Header(default="")):
    require_internal_token(x_internal_token)
    binary = request.app.state.feedback_classifier
    if binary is None:
        raise HTTPException(503, "피드백 분류기를 사용할 수 없습니다.")
    try:
        scores = binary.probabilities([i.text for i in data.items])
        eligible = [i for i,p in zip(data.items, scores, strict=True) if p > binary.threshold]
        labels = {}
        if eligible:
            primary = request.app.state.feedback_primary
            labels = dict(zip((i.id for i in eligible), primary.labels([i.text for i in eligible]), strict=True))
        return [PrimaryOutput(id=i.id, isFeedback=p > binary.threshold, feedbackProbability=p,
                              threshold=binary.threshold, modelVersion=VERSION, aspectVersion=G2_VERSION,
                              primaryAspect=labels.get(i.id)) for i,p in zip(data.items,scores,strict=True)]
    except Exception:
        raise HTTPException(503, "댓글 배치 추론 실패") from None
