package ai.storyfork.content.proposal.service.dto

import jakarta.validation.constraints.*

/** 새 회차 원고 요청. plan에 BeatPlan/콘티와 문체 요청을 담는다. */
data class WritingDraftRequest(@field:Min(0) val revision: Int, @field:NotBlank @field:Size(max=4000) val plan: String, val consent: Boolean,
                               @field:Min(1) val episode: Int? = null, @field:Size(max=80) val character: String = "")

/** 작성 중 회차 초안의 UTF-16 구간 [start, end) 수정 요청. */
data class WritingPatchRequest(@field:Min(0) val revision: Int, @field:Min(0) val start: Int, @field:Min(1) val end: Int,
                               @field:NotBlank @field:Size(max=2000) val instruction: String, val consent: Boolean,
                               @field:Min(1) val episode: Int? = null, @field:Size(max=80) val character: String = "")
