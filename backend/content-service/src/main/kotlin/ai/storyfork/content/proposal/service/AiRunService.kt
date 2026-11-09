package ai.storyfork.content.proposal.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content._common.helper.episodeId
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.ContextRequest
import ai.storyfork.content.proposal.client.*
import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.work.service.WorkAccessService
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import java.security.MessageDigest
import java.time.Instant
import ai.storyfork.content.episode.repository.EpisodeRepository

/** 공개 Run의 소유권·멱등 접수·dispatch 의도를 관리한다. 원고·승인·적용은 변경하지 않는다. */
@Service
class AiRunService(
    private val access: WorkAccessService,
    private val context: ContextService,
    private val runs: AiRunRepository,
    private val threads: AiThreadRepository,
    private val jobs: AiJobRepository,
    private val client: AiRunClient,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
    private val mapper: JsonMapper,
    private val grants: AiRunGrantService,
    private val episodes: EpisodeRepository,
) {
    private val operations=setOf("ask","simulate","next_draft","next_insights","review","edit",
        "expand_conti","world_plot_change","recommend_template","auto")
    private data class Prepared(val response: AiRunResponse,val run: AiRunEntity?)
    private data class Snapshot(val digest: String,val targets: List<AiRunSourceRef>)

    fun create(workId: String,subject: String,key: String?,data: AiRunRequest): AiRunResponse {
        val prepared=transaction.execute {
            // 기존 작품 행 잠금이 같은 작품의 접수를 직렬화한다. DB unique도 함께 둔다.
            val work=access.own(workId,subject)
            checkContent(key!=null && key.length in 1..200 && key.all {it.code in 33..126},message="Idempotency-Key를 확인해 주세요.")
            validate(data)
            val forkId=if(work.source==null) null else workId
            checkContent(data.target.forkId==forkId,message="작품과 Fork 범위를 확인해 주세요.")
            val requestHash=hash(mapper.writeValueAsString(data))
            val previous=runs.findByRequesterIdAndWorkIdAndOperationAndKeyHash(subject,workId,data.operation,hash(key!!))
            if(previous!=null) {
                checkContent(previous.requestHash==requestHash,409,"같은 키에 다른 요청이 연결되어 있어요.")
                snapshot(workId,subject,data.target)
                return@execute Prepared(response(previous),null)
            }
            access.requireRevision(work,data.target.baseRevision)
            val thread=data.threadId?.let {ownThread(it,workId,subject,forkId)}
                ?: AiThreadEntity(id=contentId(),requesterId=subject,workId=workId,forkId=forkId)
            checkContent(!runs.existsByThreadIdAndStatusIn(thread.id,listOf("pending","running")),409,"이 대화에서 실행 중인 작업이 있어요.")
            val scope=snapshot(workId,subject,data.target)
            if(data.threadId==null) threads.saveAndFlush(thread)
            val consent=data.options.modelConsent!!
            val id=contentId()
            jobs.saveAndFlush(AiJobEntity(id=id,requesterId=subject,workId=workId,kind="run:${data.operation}",status="running"))
            val run=AiRunEntity(id=id,threadId=thread.id,requesterId=subject,workId=workId,operation=data.operation,
                keyHash=hash(key),requestHash=requestHash,scopeHash=scope.digest,basisEpisode=data.target.basisEpisode,
                baseRevision=data.target.baseRevision,targetRefsJson=mapper.writeValueAsString(scope.targets),
                grantExpiresAt=Instant.now().plusSeconds(300).truncatedTo(java.time.temporal.ChronoUnit.SECONDS),
                characterName=data.target.character,maxCalls=consent.maxCalls,noticeVersion=consent.noticeVersion)
            runs.saveAndFlush(run)
            Prepared(response(run),run)
        }
        val run=prepared.run ?: return prepared.response
        // shortcut: 자동 재전송·장애 재개 없음, dispatcher/Content lease를 도입할 때 같은 run으로 복구한다.
        return transfer(run,workId,subject,false)
    }

    fun read(workId: String,subject: String,runId: String): AiRunResponse {
        val run=transaction.execute { authorizedRun(workId,subject,runId) }
        return if(run.dispatchStatus=="accepted" && run.status in listOf("pending","running")) transfer(run,workId,subject,true) else response(run)
    }

    private fun authorizedRun(workId: String,subject: String,runId: String): AiRunEntity {
        val work=access.own(workId,subject)
        val run=runs.findById(runId).orElse(null)
        checkContent(run!=null && run.workId==workId && run.requesterId==subject,404,"작업을 찾을 수 없어요.")
        ownThread(run!!.threadId,workId,subject,if(work.source==null) null else workId)
        checkContent(work.revision==run.baseRevision,409,"작업 기준 판본이 변경됐어요.")
        val scope=snapshot(workId,subject,AiRunTarget(run.basisEpisode,if(work.source==null) null else workId,run.characterName,run.baseRevision))
        checkContent(scope.digest==run.scopeHash,409,"작업의 허용 문맥이 변경됐어요.")
        return run
    }

    private fun transfer(run: AiRunEntity,workId: String,subject: String,poll: Boolean): AiRunResponse {
        var remote: AiRunRemoteResponse?=null
        val failure=try {
            val request=dispatchRequest(run)
            remote=if(poll) client.status(request) else client.dispatch(request)
            when(remote.status) {
                "denied" -> AiRunFailure.AI_RUN_REFUSED
                "failed" -> when(remote.error?.code) {
                    "dependency_unavailable" -> AiRunFailure.AI_RUN_EXECUTOR_UNAVAILABLE
                    "timeout" -> AiRunFailure.AI_RUN_TIMEOUT
                    else -> AiRunFailure.AI_RUN_UNAVAILABLE
                }
                else -> null
            }
        } catch(error: AiRunDispatchException) {error.failure}
          catch(_: RuntimeException) {AiRunFailure.AI_RUN_UNAVAILABLE}
        return transaction.execute {
            val current=authorizedRun(workId,subject,run.id)
            if(current.status in listOf("failed","denied")) return@execute response(current)
            val job=jobs.findById(run.id).orElseThrow()
            current.status=if(failure==null) remote!!.status else if(failure==AiRunFailure.AI_RUN_REFUSED) "denied" else "failed"
            current.dispatchStatus=if(failure==null || remote!=null) "accepted" else if(failure==AiRunFailure.AI_RUN_UNCONFIGURED) "blocked" else "failed"
            current.errorCode=failure?.name
            job.status=if(failure==null) "running" else "failed"
            job.failureReason=failure?.name
            if(failure!=null) job.finishedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
            jobs.saveAndFlush(job);runs.saveAndFlush(current)
            response(current)
        }
    }

    fun verifyGrant(runId: String,data: AiRunDispatchRequest): AiRunGrantResponse = transaction.execute {
        val run=runs.findById(runId).orElse(null) ?: throw ContentFailure(403,"작업 위임을 확인할 수 없어요.")
        grants.requireValid(run,data.grantRef)
        checkContent(data==dispatchRequest(run),403,"작업 위임의 범위를 확인할 수 없어요.")
        authorizedRun(run.workId,run.requesterId,run.id)
        AiRunGrantResponse(run.id,run.threadId,run.scopeHash,run.grantExpiresAt)
    }

    private fun dispatchRequest(run: AiRunEntity): AiRunDispatchRequest {
        val thread=threads.findById(run.threadId).orElseThrow()
        val targets=mapper.readValue(run.targetRefsJson,Array<AiRunSourceRef>::class.java).toList()
        return AiRunDispatchRequest(run.id,run.threadId,grants.token(run),run.operation,targets,AiRunBudget(run.maxCalls),
            run.workId,thread.forkId,run.basisEpisode)
    }

    fun thread(workId: String,subject: String,threadId: String,cursor: Int,limit: Int): AiThreadResponse = transaction.execute {
        val work=access.own(workId,subject)
        val thread=ownThread(threadId,workId,subject,if(work.source==null) null else workId)
        checkContent(cursor>=0 && limit in 1..50,message="대화 조회 범위를 확인해 주세요.")
        val page=runs.findAllByThreadIdOrderByCreatedAtAscIdAsc(threadId,PageRequest.of(cursor,limit))
        AiThreadResponse(thread.id,workId,thread.forkId,page.content.map(::response),if(page.hasNext()) cursor+1 else null)
    }

    private fun ownThread(id: String,workId: String,subject: String,forkId: String?): AiThreadEntity {
        val thread=threads.findById(id).orElse(null)
        checkContent(thread!=null && thread.workId==workId && thread.requesterId==subject && thread.forkId==forkId,
            404,"대화를 찾을 수 없어요.")
        return thread!!
    }

    private fun snapshot(workId: String,subject: String,target: AiRunTarget): Snapshot {
        val selected=context.read(workId,subject,ContextRequest(target.basisEpisode,"",target.character))
        val targets=selected.episodes.map {AiRunSourceRef(workId,"manuscript",episodeId(workId,it.number),it.versionId)}.toMutableList()
        targets+=selected.settings.map {AiRunSourceRef(workId,"setting",it.id,it.versionId)}
        if(target.character.isEmpty() && selected.episodes.none {it.number==target.basisEpisode}) {
            val episode=episodes.findByWorkIdAndSequence(workId,target.basisEpisode) ?: throw ContentFailure(422,"기준 원고를 찾을 수 없어요.")
            targets+=AiRunSourceRef(workId,"draft",episode.id,target.baseRevision.toString())
        }
        checkContent(targets.size in 1..100 && targets.all {it.documentId.isNotBlank() && it.revision.isNotBlank()},message="허용된 원고·설정 범위를 좁혀 주세요.")
        return Snapshot(hash(target.baseRevision.toString()+":"+mapper.writeValueAsString(selected)),targets)
    }

    private fun validate(data: AiRunRequest) {
        checkContent(data.operation in operations && data.prompt.length<=2000 && (data.threadId==null || data.threadId.length in 1..36),
            message="작업 유형과 요청 길이를 확인해 주세요.")
        checkContent(data.target.basisEpisode>=1 && data.target.baseRevision>=0 && data.target.character.length<=80,message="기준 회차·인물 범위를 확인해 주세요.")
        val consent=data.options.modelConsent
        checkContent(consent!=null && consent.providers==listOf("openai") && consent.purpose==data.operation
            && consent.maxCalls in 1..20 && consent.noticeVersion.isNotBlank() && consent.noticeVersion.length<=80,
            message="모델 제공사·용도·최대 호출 수·안내 버전에 동의해 주세요.")
    }

    private fun response(run: AiRunEntity)=AiRunResponse(run.id,run.threadId,run.workId,run.status,run.dispatchStatus,
        run.errorCode?.let {AiRunErrorResponse(it)})
    private fun hash(value: String)=java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))
}
