package ai.storyfork.content.work.service.dto

/** 장르·키워드 추천 후보(#372). 저장하지 않으며 작가가 고른 값만 `PUT /api/v1/works/{id}`로 저장한다. */
data class WorkTagSuggestionResponse(val genres: List<String>, val hashtags: List<String>)
