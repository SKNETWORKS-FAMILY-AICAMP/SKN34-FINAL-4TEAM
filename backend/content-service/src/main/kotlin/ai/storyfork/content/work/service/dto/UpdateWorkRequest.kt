package ai.storyfork.content.work.service.dto

import jakarta.validation.constraints.*

/**
 * 작품 제목·소개(와 선택으로 장르·해시태그)를 수정하는 요청이다. revision은 수정 전에 읽은 작품의 revision이며 다르면 409다.
 * [genres]·[hashtags]를 생략(null)하면 저장된 값을 그대로 두고, 보내면(빈 배열 포함) 작품 등록과 같은 규칙으로 검증해 통째로 바꾼다.
 */
data class UpdateWorkRequest(
    @field:NotBlank @field:Size(max=120) val title: String,
    @field:Size(max=2000) val summary: String = "",
    @field:Min(0) val revision: Int,
    val genres: List<String>? = null,
    val hashtags: List<String>? = null,
)
