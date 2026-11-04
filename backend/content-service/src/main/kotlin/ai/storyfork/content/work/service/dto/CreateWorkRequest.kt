package ai.storyfork.content.work.service.dto

import jakarta.validation.constraints.*

/**
 * 작품 등록 요청이다. 유형·장르·해시태그·권리 확인 중 하나라도 보내면 #49 등록 규칙을 모두 검증한다.
 * 넷 다 생략한 요청은 기존 제목·소개만 보내는 화면과의 호환을 위한 임시 경로이며 화면 연결이 끝나면 제거한다.
 */
data class CreateWorkRequest(
    @field:NotBlank @field:Size(max=120) val title: String,
    @field:Size(max=2000) val summary: String = "",
    val creationType: String? = null,
    val genres: List<String> = emptyList(),
    val hashtags: List<String> = emptyList(),
    val rightsConfirmed: Boolean? = null,
)
