package ai.storyfork.operations.notice.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

/** 생성·전체 교체에 공통으로 사용하는 일반 텍스트 공지 입력이다. */
data class NoticeRequest(
    @field:NotBlank
    @field:Size(max = 200)
    val title: String,
    @field:NotBlank
    @field:Size(max = 20_000)
    val body: String,
)
