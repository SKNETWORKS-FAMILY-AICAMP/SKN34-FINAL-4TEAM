package ai.storyfork.content.comment.service.dto

import java.time.Instant

/**
 * 댓글 하나다. liked·mine은 Bearer가 있으면 그 회원 기준이고 익명이면 false이며, edited는 updatedAt > createdAt이다.
 * [hidden]이면 운영이 숨긴 댓글이라 body는 "", quote는 null이고 나머지 값은 그대로다.
 */
data class CommentResponse(
    val id: String, val workId: String, val episodeNumber: Int, val publishedVersionId: String,
    val authorName: String, val body: String, val quote: String?, val spoiler: Boolean,
    val likeCount: Int, val liked: Boolean, val mine: Boolean, val edited: Boolean, val hidden: Boolean,
    val createdAt: Instant, val updatedAt: Instant,
)

/** 회차 댓글 목록이다. 최대 200개이며 페이지네이션은 없다. */
data class CommentListResponse(val items: List<CommentResponse>)
