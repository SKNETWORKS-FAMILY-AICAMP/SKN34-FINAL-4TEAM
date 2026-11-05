package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

/** 탈퇴 요청. 본인 확인용 현재 비밀번호와 선택 사유를 받는다. */
data class WithdrawalRequest(@field:NotBlank val password: String, @field:Size(max = 300) val reason: String? = null)
