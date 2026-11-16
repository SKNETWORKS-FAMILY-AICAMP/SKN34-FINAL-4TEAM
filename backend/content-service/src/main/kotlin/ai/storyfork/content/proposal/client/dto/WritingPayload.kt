package ai.storyfork.content.proposal.client.dto

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.proposal.service.dto.UsageResponse

/** AI `POST /internal/v1/writing/drafts` 요청. context는 Content가 고른 허용 문맥 JSON이다. */
data class WritingDraftPayload(val episodeNumber: Int, val plan: String, val context: String) {
    init {
        // AI DraftRequest.context 한도(60,000자)를 넘으면 유료 호출 전에 입력 오류로 돌려준다.
        checkContent(context.length <= 60000, 422, "초안과 설정 문맥이 너무 길어요. 기준 회차나 원고 분량을 줄여 주세요.")
    }
}

/** AI `POST /internal/v1/writing/patches` 요청. 앞뒤 문장은 읽기 전용 문맥이다. */
data class WritingPatchPayload(val selection: String, val instruction: String, val precedingText: String,
                               val followingText: String, val context: String)

data class WritingPatchResponse(val before: String, val after: String, val model: String,
                                val providerResponseId: String? = null, val usage: UsageResponse? = null)
