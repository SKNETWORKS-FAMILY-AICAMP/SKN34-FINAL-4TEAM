package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

/** 운영 관리자 계정 생성 요청. */
data class AdminCreateRequest(
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 80) val nickname: String,
    @field:NotBlank @field:Size(min = 8, max = 72) val password: String,
)
