package ai.storyfork.content.work.service.dto

import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.episode.service.dto.DraftResponse
import java.time.Instant

data class WorkResponse(
    val id: String, val title: String, val summary: String, val visibility: String,
    val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?,
    val episodes: List<PublishedEpisodeResponse>, val draft: DraftResponse?,
    val hasWritingEpisode: Boolean = true,
    val creationType: String = "ORIGINAL", val genres: List<String> = emptyList(), val hashtags: List<String> = emptyList(),
    val slug: String? = null, val authorName: String = "작성자", val ownerId: String = "", val revision: Int = 0,
    val theme: String = "star", val hook: String = "", val hanja: String? = null,
    val hero: List<String>? = null, val heroBg: String? = null,
    val forkableEpisodes: List<Int> = emptyList(),
    /** 최근 24시간 조회 수. 공개 목록·검색·랭킹 응답에서만 채우고 그 밖에는 0이다. */
    val views: Long = 0,
    /** 공개 좋아요 수. 공개 목록·검색·랭킹·상세 응답에서만 채우고 그 밖에는 0이다. */
    val likes: Long = 0,
    /** 요청한 회원이 좋아요를 눌렀는지. 공개 상세에서만 채우고 익명이거나 그 밖의 응답이면 false다. */
    val liked: Boolean = false,
    /** 작품 회차의 마지막 발행 시각. 기간별 랭킹의 방금 업데이트(updated)에서만 채우고 그 밖의 응답은 null이다. */
    val updatedAt: Instant? = null,
    val writingEpisodeNumber: Int? = null,
)
