package ai.storyfork.content.work.service.dto

import java.time.Instant

/** 기간별 랭킹 응답이다. [computedAt]은 집계 계산 시각이고 [kind]·[period]·[type]은 적용한 값(소문자)이다. */
data class WorkRankingResponse(val items: List<WorkResponse>, val computedAt: Instant, val kind: String, val period: String, val type: String)
