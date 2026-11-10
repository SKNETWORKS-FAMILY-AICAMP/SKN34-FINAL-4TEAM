package ai.storyfork.content.fork.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.entity.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.episode_version.service.dto.*
import ai.storyfork.content.publication.entity.*
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.fork.entity.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.service.dto.*
import ai.storyfork.content.world.domain.selectSettings

@Service
@Transactional(transactionManager="contentTransactionManager")
class ForkService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val members: ai.storyfork.content.work.service.ContentMemberService,
    private val workService: ai.storyfork.content.work.service.WorkService,
    private val publication: ai.storyfork.content.publication.service.PublicationService,
    private val world: ai.storyfork.content.world.service.WorldService,
    private val checkpoints: ai.storyfork.content.episode_version.service.EpisodeVersionService,
    private val works: WorkRepository,
    private val workWorlds: WorkWorldHistoryRepository,
    private val visibility: WorkPublicationHistoryRepository,
    private val policies: ForkPolicyHistoryRepository,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val versions: EpisodeVersionRepository,
    private val forks: ForkRepository,
    private val references: ForkWorldReferenceRepository,
    private val changes: ForkSourceChangeRepository,
    private val decisions: ForkChangeDecisionRepository,
    private val applications: ForkChangeApplicationRepository,
) {

    fun create(id: String,owner: String,data: ForkRequest): WorkResponse {
        access.lockScope(id);val original=access.get(id)
        checkContent(original.source==null && original.publiclyVisible() && original.allowFork,403,"이 작품은 분기를 허용하지 않아요.")
        val published=publication.publishedEpisodes(id).items
        checkContent(data.episode in published.map {it.number},message="공개된 기준 회차를 선택해 주세요.")
        checkContent(data.episode in access.forkable(id,published.map {it.number}),403,"이 회차에서는 분기할 수 없어요.")
        checkContent(forks.findAllByOwnerIdAndSourceWorkId(owner,id).isEmpty(),409,"이미 만든 분기 작품이 있어요.")
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.summary.length<=2000 && data.direction.length<=2000,message="분기 작품 입력을 확인해 주세요.")
        members.ensure(owner)
        val forkId=contentId();val prefix=published.filter {it.number<=data.episode}
        val basisSettings=selectSettings(world.historyForContext(id).items.map {it.toDomain()},data.episode,true).map {it.toPayload()}
        works.saveAndFlush(WorkEntity(id=forkId,ownerId=owner,title=data.title.trim(),description=data.summary,originKind="fork",revision=0))
        val history=workWorlds.saveAndFlush(WorkWorldHistoryEntity(id=contentKey("work-world",forkId,"0"),workId=forkId,worldId=original.worldId,revisionNo=0))
        visibility.saveAndFlush(WorkPublicationHistoryEntity(id=contentKey("work-publication",forkId,"0"),workId=forkId,revisionNo=0,visibility="private"))
        prefix.forEach {e ->
            val row=episodes.saveAndFlush(EpisodeEntity(id=episodeId(forkId,e.number),workId=forkId,sequence=e.number))
            versions.saveAndFlush(EpisodeVersionEntity(id=episodeVersionId(forkId,e.number,e.versionId),episodeId=row.id,contentVersionId=e.versionId,revisionNo=e.version,title=e.title,content=e.body,createdAt=Instant.EPOCH,isSaved=false,workWorldHistoryId=history.id))
        }
        val next=data.episode+1
        val row=episodes.saveAndFlush(EpisodeEntity(id=episodeId(forkId,next),workId=forkId,sequence=next))
        drafts.saveAndFlush(EpisodeDraftEntity(episodeId=row.id,title="새 회차",content="",editRevision=0))
        val cp=contentKey("checkpoint",forkId)
        checkpoints.capture(CheckpointRequest(cp,id,id,data.episode,prefix,original.worldId,basisSettings))
        val policy=policies.findFirstByWorkIdOrderByRevisionNoDesc(id)
        forks.saveAndFlush(ForkEntity(workId=forkId,sourceWorkId=id,ownerId=owner,sourceCheckpointId=cp,sourceTitle=original.title,direction=data.direction,worldRevision=0,confirmedPolicyHistoryId=policy?.id,conditionsConfirmedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)))
        references.saveAndFlush(ForkWorldReferenceEntity(forkWorkId=forkId,sourceWorldId=original.worldId,referenceStatus="following",lastFollowedCheckpointId=cp))
        return workService.read(forkId,owner)
    }
    fun decideChange(id: String,owner: String,data: ChangeRequest): WorldResponse {
        val w=access.own(id,owner)
        checkContent(data.decision in setOf("apply","reject"),message="변경 선택을 확인해 주세요.")
        val source=w.source ?: throw ContentFailure(409,"원작 변경이 없는 작품이에요.")
        val before=world.read(id,owner)
        checkContent(before.revision==data.revision,409,"설정집이 변경됐어요. 최신 데이터를 불러와 주세요.")
        val change=before.changes.find {it.id==data.changeId} ?: throw ContentFailure(409,"원본 변경이 달라졌어요. 알림을 다시 확인해 주세요.")
        checkContent(change.decision!="apply",409,"이미 반영한 변경이에요. 버전 복원을 이용해 주세요.")
        val snapshots=world.sourceSnapshots(id,owner)
        val prefix=publication.publishedEpisodes(id).items
        val changeId=contentKey("source-change",id,change.id)
        val previous=decisions.findAllBySourceChangeIdInOrderByDecidedAtAscIdAsc(listOf(changeId)).lastOrNull()
        world.applySourceChange(id,owner,data)
        if(previous?.decision!=data.decision) {
            val beforeId=contentKey("change-before",changeId);val afterId=contentKey("change-after",changeId)
            checkpoints.capture(CheckpointRequest(beforeId,source.workId,source.workId,source.episode,prefix,snapshots.sourceWorldId,snapshots.before))
            checkpoints.capture(CheckpointRequest(afterId,source.workId,source.workId,source.episode,prefix,snapshots.sourceWorldId,snapshots.after))
            if(!changes.existsById(changeId)) changes.saveAndFlush(ForkSourceChangeEntity(id=changeId,forkWorkId=id,sourceChangeRef=change.id,beforeCheckpointId=beforeId,afterCheckpointId=afterId))
            val event=decisions.saveAndFlush(ForkChangeDecisionEntity(id=contentId(),sourceChangeId=changeId,actorId=owner,decision=data.decision))
            if(data.decision=="apply") {
                val result=contentKey("change-result",event.id)
                val snapshot=world.snapshot(id,owner,source.episode)
                checkpoints.capture(CheckpointRequest(result,id,source.workId,source.episode,prefix,snapshot.worldId,snapshot.settings))
                applications.saveAndFlush(ForkChangeApplicationEntity(id=contentId(),decisionId=event.id,resultCheckpointId=result,outcome="applied"))
            }
        }
        return world.read(id,owner)
    }

}
