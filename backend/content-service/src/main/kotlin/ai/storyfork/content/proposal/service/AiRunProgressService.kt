package ai.storyfork.content.proposal.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.AiRunEventRepository
import ai.storyfork.content.proposal.service.dto.*
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import tools.jackson.databind.json.JsonMapper

/** 호출자의 작품 잠금·Content transaction 안에서 결과와 이벤트를 함께 쓴다. */
@Service
class AiRunProgressService(private val events: AiRunEventRepository,private val mapper: JsonMapper) {
    private val messages=mapOf("ANALYZING" to "요청을 분석하고 있습니다.","CONTEXT_LOADING" to "회차별 맥락을 확인하고 있습니다.",
        "RELATIONS_LOADING" to "인물 관계를 확인하고 있습니다.","TEXT_LOADING" to "관련 원고를 찾고 있습니다.",
        "TEMPLATE_SEARCH" to "세계관 템플릿을 찾고 있습니다.","SIMULATING" to "인물의 행동을 시뮬레이션하고 있습니다.",
        "REVIEWING" to "설정과 플롯을 검수하고 있습니다.","DRAFTING" to "초안을 작성하고 있습니다.",
        "EDITING" to "선택한 문단을 수정하고 있습니다.","PROPOSAL_PENDING" to "변경안을 확인해 주세요.",
        "RESULT_READY" to "결과가 준비되었습니다.","APPLIED" to "변경사항을 저장했습니다.",
        "PARTIAL" to "일부 결과가 준비되었습니다.","FAILED" to "작업을 완료하지 못했습니다.","CANCELLED" to "작업을 취소했습니다.")
    private val codes=mapOf("pending" to "ANALYZING","running" to "ANALYZING","succeeded" to "RESULT_READY",
        "partial" to "PARTIAL","failed" to "FAILED","denied" to "FAILED","clarification" to "RESULT_READY",
        "cancelled" to "CANCELLED","proposal" to "PROPOSAL_PENDING","awaiting_approval" to "PROPOSAL_PENDING",
        "applied" to "APPLIED","rejected" to "RESULT_READY","revision_requested" to "RESULT_READY")

    fun append(run: AiRunEntity,event: AiRunProgressInput) {
        checkContent(event.taskId.matches(Regex("[a-z][a-z0-9_-]{0,63}")) && event.attempt in 1..3 &&
            event.phase in listOf("task","run") && event.step>0 && event.code in messages &&
            event.status in codes.keys+"skipped",502,"진행 이벤트 계약을 확인할 수 없어요.")
        val previous=events.findFirstByRunIdAndTaskIdAndAttemptAndPhaseOrderByStepDesc(run.id,event.taskId,event.attempt,event.phase)
        if(previous!=null && previous.step>=event.step) return
        checkContent(run.lastEventId<Long.MAX_VALUE,409,"진행 번호 한도에 도달했어요.")
        events.saveAndFlush(AiRunEventEntity(contentId(),run.id,++run.lastEventId,event.taskId,event.attempt,event.phase,event.step,event.code,event.status))
    }

    fun state(run: AiRunEntity,status: String,outcome: AiRunOutcome? = null) {
        val previous=events.findFirstByRunIdAndTaskIdAndAttemptAndPhaseOrderByStepDesc(run.id,"run",1,"run")
        if(previous?.status!=status) {
            checkContent((previous?.step ?: 0)<Int.MAX_VALUE,409,"진행 단계 한도에 도달했어요.")
            append(run,AiRunProgressInput("run",1,"run",(previous?.step ?: 0)+1,codes.getValue(status),status))
        }
        run.status=status
        if(outcome!=null) run.resultJson=mapper.writeValueAsString(outcome)
    }

    fun result(run: AiRunEntity): AiRunOutcome?=run.resultJson?.let {mapper.readValue(it,AiRunOutcome::class.java)}

    fun page(run: AiRunEntity,cursor: Long): AiRunEventsResponse {
        checkContent(cursor in 0..run.lastEventId,message="진행 cursor를 확인해 주세요.")
        if(cursor==run.lastEventId) return AiRunEventsResponse(run.id,emptyList(),run.lastEventId,run.status)
        val rows=events.findAllByRunIdAndSeqGreaterThanOrderBySeqAsc(run.id,cursor,PageRequest.of(0,100))
        checkContent(rows.firstOrNull()?.seq==cursor+1,410,"진행 기록이 만료됐어요. 작업 상태를 다시 조회해 주세요.")
        checkContent(rows.zipWithNext().all {(a,b) -> b.seq==a.seq+1},410,"진행 기록이 만료됐어요. 작업 상태를 다시 조회해 주세요.")
        return AiRunEventsResponse(run.id,rows.map {AiRunEventResponse(run.id,it.seq,it.taskId,it.attempt,it.phase,it.step,it.code,it.status,messages.getValue(it.code))},run.lastEventId,run.status)
    }
}
