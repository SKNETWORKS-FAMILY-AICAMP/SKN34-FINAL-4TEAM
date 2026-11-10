package ai.storyfork.content.editsuggestion.domain

/** 초안 본문에서 변경 전 문장을 한 번 바꾼 결과다. 바꿀 수 없으면 [Failed.reason]이 반영 실패 사유 문장이다. */
sealed interface DraftReplacement {
    data class Replaced(val body: String) : DraftReplacement
    data class Failed(val reason: String) : DraftReplacement
}

/** 수정 제안의 상태 전이와 승인 반영 규칙(계약 2절). 상태는 `pending`·`approved`·`rejected`·`held`, 반영 결과는 `applied`·`failed`다. */
object EditSuggestionRules {
    const val PENDING = "pending"
    const val APPROVED = "approved"
    const val REJECTED = "rejected"
    const val HELD = "held"
    const val APPLIED = "applied"
    const val FAILED = "failed"

    const val NOT_FOUND_IN_DRAFT = "초안에서 고칠 문장을 찾을 수 없어요. 집필실에서 직접 고쳐 주세요."
    const val AMBIGUOUS_IN_DRAFT = "초안에 같은 문장이 여러 곳 있어 한 곳을 정할 수 없어요. 집필실에서 직접 고쳐 주세요."
    const val INHERITED_EPISODE = "원작 기준 회차는 수정할 수 없어요."

    /** 편집안 저장·거절은 아직 판단하지 않은 `pending`/`held`에서만 한다. */
    fun canEdit(status: String) = status == PENDING || status == HELD
    fun canReject(status: String) = canEdit(status)

    /** 승인은 `pending`/`held`에서 하고, 반영이 실패한 `approved`는 다시 시도할 수 있다. */
    fun canApprove(status: String, applyResult: String?) = canEdit(status) || (status == APPROVED && applyResult == FAILED)

    /** 보류는 `pending`에서만 한다. 같은 전이를 반복하거나 종결 상태에서 바꾸면 안 된다. */
    fun canHold(status: String) = status == PENDING

    /**
     * 초안 본문에 [before]가 정확히 한 번 나올 때만 [after]로 바꾼다. 겹쳐서 나오는 경우도 여러 곳으로 보고,
     * 정규식이 아니라 글자 그대로 바꾸며 바꾼 글은 다시 찾지 않는다.
     * ponytail: 문자열 일치로만 반영한다. 같은 문장이 여럿이면 실패로 두고 작가가 직접 고친다.
     */
    fun replaceOnce(body: String, before: String, after: String): DraftReplacement {
        val at = body.indexOf(before)
        if (at < 0) return DraftReplacement.Failed(NOT_FOUND_IN_DRAFT)
        if (body.indexOf(before, at + 1) >= 0) return DraftReplacement.Failed(AMBIGUOUS_IN_DRAFT)
        return DraftReplacement.Replaced(body.substring(0, at) + after + body.substring(at + before.length))
    }
}
