package ai.storyfork.operations.event.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant

/** 등록과 전체 수정에 사용하는 이벤트 안내 입력이며, 생략한 기간은 비운다. */
data class EventRequest(
    @field:NotBlank @field:Size(max = 200)
    val title: String,
    @field:NotBlank @field:Size(max = 20_000)
    val body: String,
    val startsAt: Instant? = null,
    val endsAt: Instant? = null,
)
