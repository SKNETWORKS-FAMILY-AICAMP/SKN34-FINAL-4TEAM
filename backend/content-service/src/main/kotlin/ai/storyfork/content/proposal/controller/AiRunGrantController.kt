package ai.storyfork.content.proposal.controller

import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content.proposal.service.AiRunService
import org.springframework.web.bind.annotation.*

/** AI 서비스 자격과 별도로 현재 작업 위임을 검증하는 내부 읽기 전용 경계다. */
@RestController
@RequestMapping("/internal/v1/ai/runs")
class AiRunGrantController(private val service: AiRunService) {
    /** 서명·만료·작품·Fork·thread·판본·target·예산을 대조하고 승인된 Scope의 참조만 반환한다. */
    @PostMapping("/{runId}/verify")
    fun verify(@PathVariable runId: String,@RequestBody data: AiRunDispatchRequest): AiRunGrantResponse = service.verifyGrant(runId,data)

    /** 현재 위임으로 인가된 원고·설정과 작가용 Neo4j 관계를 조회한다. */
    @PostMapping("/{runId}/retrieval")
    fun retrieval(@PathVariable runId: String,@RequestBody data: AiRunDispatchRequest): AiRunRetrieval = service.retrieval(runId,data)
}
