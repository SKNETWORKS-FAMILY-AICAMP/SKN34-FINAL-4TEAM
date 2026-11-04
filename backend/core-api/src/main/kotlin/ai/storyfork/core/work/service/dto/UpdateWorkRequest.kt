package ai.storyfork.core.work.service.dto

import jakarta.validation.constraints.*

/** 작품 제목·소개를 수정하는 요청이다. revision은 수정 전에 읽은 작품의 revision이며 다르면 409다. */
data class UpdateWorkRequest(@field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=2000) val summary: String = "", @field:Min(0) val revision: Int)
