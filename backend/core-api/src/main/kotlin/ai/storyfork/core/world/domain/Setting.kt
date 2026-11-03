package ai.storyfork.core.world.domain

import ai.storyfork.core._common.exception.*

data class Setting(
    val id: String = "", val versionId: String = "", val name: String = "", val content: String = "",
    val category: String = "규칙", val tags: List<String> = emptyList(), val visibility: String = "private",
    val fromEpisode: Int = 1, val toEpisode: Int? = null, val knownBy: List<String> = emptyList(), val evidence: String = "",
)
fun validateSetting(s: Setting) {
    checkContent(s.name.isNotBlank() && s.name.length <= 120 && s.content.isNotBlank() && s.content.length <= 8000, message="설정 이름과 본문 길이를 확인해 주세요.")
    checkContent(s.visibility in setOf("private", "public") && s.category in setOf("규칙", "인물", "장소", "광물", "상태", "지식", "관계"), message="설정 종류와 공개 범위를 확인해 주세요.")
    checkContent(s.fromEpisode >= 1 && (s.toEpisode == null || s.toEpisode >= s.fromEpisode), message="설정 회차 범위를 확인해 주세요.")
    checkContent(s.tags.size <= 20 && s.knownBy.size <= 30 && (s.tags+s.knownBy).all { it.isNotBlank() && it.length <= 80 } && s.evidence.length <= 1000, message="태그·인물명·근거의 길이를 확인해 주세요.")
}
