package ai.storyfork.content.attachment.service.dto

/** 원고 이미지 대체 텍스트 수정 요청. 누락·300자 초과·제어 문자는 Service가 422로 거절한다. */
data class EpisodeImageAltTextRequest(val altText: String? = null)
