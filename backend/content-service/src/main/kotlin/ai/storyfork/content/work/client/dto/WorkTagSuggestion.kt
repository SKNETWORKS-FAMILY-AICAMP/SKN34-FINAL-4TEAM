package ai.storyfork.content.work.client.dto

/** AI 서비스 `POST /internal/v1/work-tags/suggestions` 요청 본문(#372). 장르 허용 목록(지금 고를 수 있는 활성 장르 이름)과 상한은 Content 규칙을 그대로 넘긴다. */
data class WorkTagSuggestionInput(
    val schemaVersion: String,
    val title: String,
    val description: String,
    val episodes: List<WorkTagEpisode>,
    val allowedGenres: List<String>,
    val maxGenres: Int,
    val maxHashtags: Int,
)

data class WorkTagEpisode(val number: Int, val title: String, val text: String)

/** AI 서비스가 돌려준 후보. 저장된 값이 아니다. */
data class WorkTagSuggestionOutput(val schemaVersion: String, val genres: List<String>, val hashtags: List<String>)
