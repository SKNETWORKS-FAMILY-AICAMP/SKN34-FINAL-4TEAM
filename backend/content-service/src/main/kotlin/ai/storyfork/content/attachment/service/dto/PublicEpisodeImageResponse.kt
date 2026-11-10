package ai.storyfork.content.attachment.service.dto

/** 독자 화면의 `img alt`용 공개 대체 텍스트. */
data class PublicEpisodeImageResponse(val id: String, val altText: String)

data class PublicEpisodeImageListResponse(val images: List<PublicEpisodeImageResponse>)
