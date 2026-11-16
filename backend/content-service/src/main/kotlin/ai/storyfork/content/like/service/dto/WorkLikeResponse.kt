package ai.storyfork.content.like.service.dto

/** 좋아요 누르기·취소 결과. [likes]는 작품의 현재 좋아요 수, [liked]는 요청한 회원의 현재 좋아요 여부다. */
data class WorkLikeResponse(val likes: Long, val liked: Boolean)
