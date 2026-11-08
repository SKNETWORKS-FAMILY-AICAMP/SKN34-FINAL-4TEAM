package ai.storyfork.core.auth.service.dto

/** 운영 전용 회원 목록 응답(최대 200개). */
data class MemberListResponse(val items: List<MemberItem>)
