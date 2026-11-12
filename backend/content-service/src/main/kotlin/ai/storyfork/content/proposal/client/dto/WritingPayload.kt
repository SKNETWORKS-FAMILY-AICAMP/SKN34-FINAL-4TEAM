package ai.storyfork.content.proposal.client.dto

import ai.storyfork.content.proposal.service.dto.UsageResponse

/** AI `POST /internal/v1/writing/drafts` 요청. context는 Content가 고른 허용 문맥 JSON이다. */
data class WritingDraftPayload(val episodeNumber: Int, val plan: String, val context: String)

/** AI `POST /internal/v1/writing/patches` 요청. 앞뒤 문장은 읽기 전용 문맥이다. */
data class WritingPatchPayload(val selection: String, val instruction: String, val precedingText: String,
                               val followingText: String, val context: String)

data class WritingPatchResponse(val before: String, val after: String, val model: String,
                                val providerResponseId: String? = null, val usage: UsageResponse? = null)
