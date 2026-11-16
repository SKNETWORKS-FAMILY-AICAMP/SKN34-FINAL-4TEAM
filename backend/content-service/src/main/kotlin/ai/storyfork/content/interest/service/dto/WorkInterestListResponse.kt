package ai.storyfork.content.interest.service.dto

/** 로그인 회원의 관심 작품 id. 최근 등록순이며 지금 공개 중인 작품만 담는다. */
data class WorkInterestListResponse(val workIds: List<String>)
