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
import ai.storyfork.content.proposal.domain.ChangeSetPolicy.scopeHash
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
    private val progress: AiRunProgressService,
    private val proposals: ChangeProposalVersionRepository,
    private val receipts: ChangeProposalReceiptRepository,
    @Qualifier("contentEntityManager") private val em: jakarta.persistence.EntityManager,
    private val studio: ai.storyfork.content.world.service.WorldStudioService,
    private val changes: ChangeProposalService,
    private val drafts: ai.storyfork.content.episode.repository.EpisodeDraftRepository,
) {
    private val active=setOf("pending","running","awaiting_approval")
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
            checkContent(!runs.existsByThreadIdAndStatusIn(thread.id,active),409,"이 대화에서 실행 중인 작업이 있어요.")
            val scope=snapshot(workId,subject,data.target)
            data.target.selection?.let {
                checkContent(data.target.character.isEmpty() && it.revision>=0,message="선택 편집은 작가 원고 문맥에서 요청해 주세요.")
                val draft=drafts.findById(episodeId(workId,data.target.basisEpisode)).orElse(null)
                checkContent(draft!=null && draft.editRevision==it.revision,409,"선택한 원고 판본이 변경됐어요.")
                ai.storyfork.content.proposal.domain.validateRunSelection(context.read(workId,subject,ContextRequest(data.target.basisEpisode,"","")).draft,it)
            }
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
            run.inputJson=mapper.writeValueAsString(data)
            progress.state(run,"pending")
            runs.saveAndFlush(run)
            Prepared(response(run),run)
        }
        val run=prepared.run ?: return prepared.response
        // shortcut: 자동 재전송·장애 재개 없음, dispatcher/Content lease를 도입할 때 같은 run으로 복구한다.
        return transfer(run,workId,subject,false)
    }

    fun read(workId: String,subject: String,runId: String): AiRunResponse {
        val run=transaction.execute { authorizedRun(workId,subject,runId) }
        if(run.status=="awaiting_approval" && progress.result(run)?.proposalId!=null) return response(run)
        return if(run.dispatchStatus=="accepted" && run.status in active) transfer(run,workId,subject,true) else response(run)
    }

    /** SSE 구독은 실행을 만들거나 AI를 호출하지 않는다. 모든 배치마다 현재 소유권을 재확인한다. */
    fun events(workId: String,subject: String,runId: String,lastId: String?,cursor: String?): AiRunEventsResponse = transaction.execute {
        val run=authorizedRun(workId,subject,runId)
        checkContent(lastId==null || cursor==null || lastId==cursor,message="진행 cursor가 서로 달라요.")
        val raw=lastId ?: cursor ?: "0"
        checkContent(raw.matches(Regex("0|[1-9][0-9]{0,18}")),message="진행 cursor를 확인해 주세요.")
        val after=raw.toLongOrNull()
        checkContent(after!=null,message="진행 cursor를 확인해 주세요.")
        progress.page(run,after!!)
    }

    /** 작품 잠금 아래 취소 CAS를 먼저 커밋한다. 늦은 AI 응답과 승인 쓰기는 이 상태를 넘을 수 없다. */
    fun cancel(workId: String,subject: String,runId: String): AiRunResponse {
        val run=transaction.execute {
            val current=authorizedRun(workId,subject,runId,false)
            checkContent(current.status!="applied",409,"이미 적용한 작업은 취소할 수 없어요.")
            val applied=proposals.findAllByRunId(runId).any {p ->
                receipts.findByProposalIdAndProposalVersion(p.proposalId,p.proposalVersion)?.decision=="approved"
            }
            checkContent(!applied,409,"이미 적용한 작업은 취소할 수 없어요.")
            if(current.status in active || current.status=="proposal") {
                progress.state(current,"cancelled")
                current.resultJson=null
                current.errorCode=null
                runs.saveAndFlush(current)
                val job=jobs.findById(runId).orElseThrow()
                job.status="failed";job.failureReason="CANCELLED";job.finishedAt=Instant.now()
                jobs.saveAndFlush(job)
            }
            current
        }
        if(run.status=="cancelled" && !run.cancelSignalled) {
            val remote=try {client.cancel(dispatchRequest(run))}
                catch(_: RuntimeException) {throw ContentFailure(503,"취소는 기록했지만 실행 중단 확인에 실패했어요. 같은 작업으로 다시 요청해 주세요.")}
            checkContent(remote.status=="cancelled",503,"실행 중단을 확인하지 못했어요. 같은 작업으로 다시 요청해 주세요.")
            return transaction.execute {
                val current=authorizedRun(workId,subject,runId,false)
                current.cancelSignalled=true
                runs.saveAndFlush(current)
                response(current)
            }
        }
        return response(run)
    }

    private fun authorizedRun(workId: String,subject: String,runId: String,requireScope: Boolean = true): AiRunEntity {
        val work=access.own(workId,subject)
        val run=runs.findById(runId).orElse(null)
        // verifyGrant가 먼저 읽은 JPA 캐시도 작품 잠금 뒤 최신 취소/결정 상태로 맞춘다.
        if(run!=null) em.refresh(run)
        checkContent(run!=null && run.workId==workId && run.requesterId==subject,404,"작업을 찾을 수 없어요.")
        ownThread(run!!.threadId,workId,subject,if(work.source==null) null else workId)
        // 종료 응답은 참조·고정 상태만 보관한다. 적용으로 바뀐 revision 때문에 영수증 조회를 막지 않는다.
        if(!requireScope || run.status !in active && run.status!="proposal") return run
        checkContent(work.revision==run.baseRevision,409,"작업 기준 판본이 변경됐어요.")
        val scope=snapshot(workId,subject,AiRunTarget(run.basisEpisode,if(work.source==null) null else workId,run.characterName,run.baseRevision))
        checkContent(scope.digest==run.scopeHash,409,"작업의 허용 문맥이 변경됐어요.")
        return run
    }

    private fun transfer(run: AiRunEntity,workId: String,subject: String,poll: Boolean): AiRunResponse {
        val expectedEventId=run.lastEventId
        var remote: AiRunRemoteResponse?=null
        val failure=try {
            val request=dispatchRequest(run)
            remote=if(poll) client.status(request) else client.dispatch(request)
            if(remote.status=="succeeded" && run.operation in setOf("edit","next_draft","expand_conti")) {
                val answer=remote.result
                checkContent(remote.isMock==false && answer!=null && !answer.isMock && answer.status=="succeeded",502,"실제 생성 결과를 확인할 수 없어요.")
                val source=retrieval(run.id,workId,run.scopeHash,subject,request)
                checkContent(source.digest==answer!!.contextDigest,409,"생성에 사용한 자료가 변경됐어요.")
                val draft=drafts.findById(episodeId(workId,run.basisEpisode)).orElse(null)
                val candidate=ai.storyfork.content.proposal.domain.generatedChange(request,run.baseRevision,
                    draft?.title ?: "",source.context.draft,draft?.editRevision ?: -1,answer.text,answer.citations)
                changes.prepare(workId,subject,"live:"+run.id,candidate)
                return transaction.execute {response(authorizedRun(workId,subject,run.id))}
            }
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
            if(current.status !in active || current.lastEventId!=expectedEventId) return@execute response(current)
            val job=jobs.findById(run.id).orElseThrow()
            val status=if(failure==null) remote!!.status else if(failure==AiRunFailure.AI_RUN_REFUSED) "denied" else "failed"
            if(current.status=="awaiting_approval" && status in setOf("pending","running","proposal")) return@execute response(current)
            if(current.status=="running" && status=="pending") return@execute response(current)
            remote?.progress?.forEach { if(it.phase=="task") progress.append(current,it) }
            progress.state(current,status,remote?.outcome)
            current.dispatchStatus=if(failure==null || remote!=null) "accepted" else if(failure==AiRunFailure.AI_RUN_UNCONFIGURED) "blocked" else "failed"
            current.errorCode=failure?.name
            job.status=if(status in active) "running" else if(failure==null && status!="cancelled") "completed" else "failed"
            job.failureReason=failure?.name
            if(status !in active) job.finishedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
            jobs.saveAndFlush(job);runs.saveAndFlush(current)
            response(current)
        }
    }

    fun verifyGrant(runId: String,data: AiRunDispatchRequest): AiRunGrantResponse = transaction.execute {
        val run=runs.findById(runId).orElse(null) ?: throw ContentFailure(403,"작업 위임을 확인할 수 없어요.")
        grants.requireValid(run,data.grantRef)
        checkContent(data==dispatchRequest(run),403,"작업 위임의 범위를 확인할 수 없어요.")
        authorizedRun(run.workId,run.requesterId,run.id)
        AiRunGrantResponse(run.id,run.threadId,run.scopeHash,run.grantExpiresAt,run.status=="cancelled")
    }

    /** 위임·현재 판을 확인한 뒤 Content가 선택한 자료만 전송한다. */
    fun retrieval(runId: String,data: AiRunDispatchRequest): AiRunRetrieval {
        val verified=verifyGrant(runId,data)
        return retrieval(runId,data.workId,verified.scopeRef,null,data)
    }

    private fun retrieval(runId: String,workId: String,scopeRef: String,owner: String?,dispatch: AiRunDispatchRequest?): AiRunRetrieval {
        data class Binding(val subject: String,val world: java.util.UUID?,val basis: Int)
        fun binding(): Pair<Binding,ai.storyfork.content.context.service.dto.StoryContextResponse> = transaction.execute {
            val row=runs.findById(runId).orElseThrow()
            val run=authorizedRun(workId,owner ?: row.requesterId,runId)
            if(dispatch!=null) {
                grants.requireValid(run,dispatch.grantRef)
                checkContent(dispatch==dispatchRequest(run) && run.status in setOf("pending","running"),403,"종료된 작업은 자료를 읽을 수 없어요.")
            }
            val selected=context.read(workId,run.requesterId,ContextRequest(run.basisEpisode,"",run.characterName))
            val episode=if(run.characterName.isEmpty()) episodes.findByWorkIdAndSequence(workId,run.basisEpisode) else null
            checkContent(scopeRef==run.scopeHash && scopeHash(run.baseRevision,mapper.writeValueAsString(selected),episode)==scopeRef,409,"작업 문맥이 변경됐어요.")
            Binding(run.requesterId,episode?.basisWorldId,episode?.basisRevision ?: 0) to selected
        }
        val (bound,context)=binding()
        val graph=bound.world?.let { world ->
            val draft=studio.draft(world,java.util.UUID.fromString(bound.subject))
            val cards=draft.cards.filter {it.lifecycle=="active"}.associate {it.id to it.title}
            val relations=draft.relationships.filter {it.lifecycle=="active"}.mapNotNull {
                val source=cards[it.sourceCardId] ?: return@mapNotNull null
                val target=cards[it.targetCardId] ?: return@mapNotNull null
                AiRunRelation(source,target,it.label,it.body)
            }
            checkContent(binding().first==bound,409,"기준 세계관이 변경됐어요.")
            AiRunGraph(world,bound.basis,draft.relationshipVersion,relations)
        }
        val digest=hash(scopeRef+":"+mapper.writeValueAsString(graph))
        return AiRunRetrieval(scopeRef,digest,context,graph,context.episodes.associate {it.number to episodeId(workId,it.number)})
    }

    private fun dispatchRequest(run: AiRunEntity): AiRunDispatchRequest {
        val thread=threads.findById(run.threadId).orElseThrow()
        val targets=mapper.readValue(run.targetRefsJson,Array<AiRunSourceRef>::class.java).toList()
        val input=run.inputJson?.let {mapper.readValue(it,AiRunRequest::class.java)}
        return AiRunDispatchRequest(run.id,run.threadId,grants.token(run),run.operation,targets,AiRunBudget(run.maxCalls),
            run.workId,thread.forkId,run.basisEpisode,input?.prompt ?: "",input?.target?.selection)
    }

    /** 원문은 영속 이벤트에 저장하지 않고 현재 인가·판본·인용을 재검증한 응답에만 반환한다. */
    fun result(workId: String,subject: String,runId: String): AiRunResultResponse {
        val run=transaction.execute {authorizedRun(workId,subject,runId)}
        val remote=client.status(dispatchRequest(run))
        remote.result?.contextDigest?.let { expected ->
            checkContent(retrieval(runId,workId,run.scopeHash,subject,null).digest==expected,409,"검색한 원고 또는 현재 관계가 변경됐어요.")
        }
        return transaction.execute {
            val current=authorizedRun(workId,subject,runId)
            val work=access.own(workId,subject)
            checkContent(work.revision==current.baseRevision && current.status !in setOf("cancelled","applied","denied"),409,"현재 원고에서 결과를 다시 요청해 주세요.")
            val selected=context.read(workId,subject,ContextRequest(current.basisEpisode,"",current.characterName))
            val text=remote.result ?: throw ContentFailure(503,"결과 본문이 아직 준비되지 않았어요.")
            checkContent(text.status==remote.status && text.text.length<=40000 && text.citations.size<=100,502,"AI 결과 계약을 확인할 수 없어요.")
            val refs=mapper.readValue(current.targetRefsJson,Array<AiRunSourceRef>::class.java).toList()
            val citations=text.citations.map { c ->
                checkContent(c.source in refs && c.span.size==2 && c.span[0]>=0 && c.span[1]>c.span[0],403,"허용된 인용이 아니에요.")
                val excerpt=selected.episodes.find {it.number==c.episode && it.versionId==c.source.revision}?.excerpts?.find {c.span[0]>=it.start && c.span[1]<=it.end}
                    ?: throw ContentFailure(403,"현재 열람 가능한 인용이 아니에요.")
                val quote=excerpt.text.substring(c.span[0]-excerpt.start,c.span[1]-excerpt.start)
                checkContent(quote==c.quote && hash(quote)==c.sourceHash,409,"인용 원문이 변경됐어요.")
                AiRunQuote(quote,c.episode)
            }
            AiRunResultResponse(remote.status,text.text,text.isMock,citations,remote.coverage?.let {
                checkContent(it.expectedCount>=it.verifiedCount && it.verifiedCount>=0,502,"Coverage 계약을 확인할 수 없어요.")
                AiRunCoverageResponse(it.expectedCount,it.verifiedCount,it.criticalGaps.map {gap ->
                    checkContent(gap.code in setOf("missing","stale","unsupported","timeout","unverified"),502,"근거 누락 계약을 확인할 수 없어요.");gap.code})
            })
        }
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
        val episode=if(target.character.isEmpty()) episodes.findByWorkIdAndSequence(workId,target.basisEpisode) else null
        if(target.character.isEmpty() && selected.episodes.none {it.number==target.basisEpisode}) {
            if(episode==null) throw ContentFailure(422,"기준 원고를 찾을 수 없어요.")
            val editRevision=drafts.findById(episode.id).orElse(null)?.editRevision ?: target.baseRevision
            targets+=AiRunSourceRef(workId,"draft",episode.id,editRevision.toString())
        }
        checkContent(targets.size in 1..100 && targets.all {it.documentId.isNotBlank() && it.revision.isNotBlank()},message="허용된 원고·설정 범위를 좁혀 주세요.")
        return Snapshot(scopeHash(target.baseRevision,mapper.writeValueAsString(selected),episode),targets)
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
        run.errorCode?.let {AiRunErrorResponse(it)},run.lastEventId,progress.result(run))
    private fun hash(value: String)=java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))
}
