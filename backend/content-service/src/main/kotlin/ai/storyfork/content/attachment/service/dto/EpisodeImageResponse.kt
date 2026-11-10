package ai.storyfork.content.attachment.service.dto

import java.time.Instant

/** 소유자용 원고 이미지 목록 한 건. url은 소유자 다운로드 경로이고 referenced는 현재 초안 본문에 표식이 있는지다. */
data class EpisodeImageResponse(val id: String, val filename: String, val mediaType: String, val byteSize: Long, val altText: String, val createdAt: Instant, val url: String, val referenced: Boolean)

data class EpisodeImageListResponse(val images: List<EpisodeImageResponse>)
