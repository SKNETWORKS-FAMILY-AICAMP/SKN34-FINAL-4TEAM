package ai.storyfork.core.work.service

import ai.storyfork.core._common.exception.*
import ai.storyfork.core._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.transaction.annotation.Transactional
import ai.storyfork.core.work.entity.*
import ai.storyfork.core.work.repository.*
import ai.storyfork.core.work.service.dto.*
import ai.storyfork.core.episode.entity.*
import ai.storyfork.core.episode.repository.*
import ai.storyfork.core.episode.service.dto.*
import ai.storyfork.core.publication.entity.*
import ai.storyfork.core.publication.repository.*
import ai.storyfork.core.world.entity.*
import ai.storyfork.core.world.repository.*

@Service
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
@Transactional(transactionManager="contentTransactionManager")
class WorkService(
    private val access: WorkAccessService,
    private val members: ContentMemberService,
    private val works: WorkRepository,
    private val worlds: WorldRepository,
    private val workWorlds: WorkWorldHistoryRepository,
    private val visibility: WorkPublicationHistoryRepository,
    private val policies: ForkPolicyHistoryRepository,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val publication: ai.storyfork.core.publication.service.PublicationService,
    private val versions: ai.storyfork.core.episode_version.service.EpisodeVersionService,
    private val proposals: ai.storyfork.core.proposal.service.ProposalService,
) {

    fun list(owner: String): WorkListResponse {
        val rows=works.findAllByOwnerIdOrderByCreatedAtDesc(owner)
        access.lockScopes(rows.map {it.id})
        return WorkListResponse(rows.map {view(access.own(it.id,owner))})
    }
    fun publicList(): WorkListResponse {
        val rows=works.findAll().sortedByDescending {it.createdAt}
        access.lockScopes(rows.map {it.id})
        return WorkListResponse(rows.mapNotNull {
            val w=access.get(it.id)
            if(w.visibility=="public") view(w,true) else null
        })
    }
    fun read(id: String,owner: String): WorkResponse = view(access.own(id,owner))
    fun publicRead(id: String): WorkResponse = view(access.published(id),true)
    fun create(owner: String,data: CreateWorkRequest): WorkResponse {
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.summary.length<=2000,message="작품 제목과 소개를 확인해 주세요.")
        members.ensure(owner)
        val id=contentId()
        worlds.saveAndFlush(WorldEntity(id=id,ownerId=owner,name=data.title.trim()+" 설정집"))
        works.saveAndFlush(WorkEntity(id=id,ownerId=owner,title=data.title.trim(),description=data.summary.trim(),originKind="original",revision=0))
        workWorlds.saveAndFlush(WorkWorldHistoryEntity(id=contentKey("work-world",id,"0"),workId=id,worldId=id,revisionNo=0))
        visibility.saveAndFlush(WorkPublicationHistoryEntity(id=contentKey("work-publication",id,"0"),workId=id,revisionNo=0,visibility="private"))
        val episode=episodes.saveAndFlush(EpisodeEntity(id=episodeId(id,1),workId=id,sequence=1))
        drafts.saveAndFlush(EpisodeDraftEntity(episodeId=episode.id,title="새 회차",content="",editRevision=0))
        return read(id,owner)
    }
    fun policy(id: String,owner: String,data: PolicyRequest): WorkResponse {
        val w=access.own(id,owner);access.requireRevision(w,data.revision)
        checkContent(w.source==null,403,"분기 작품에서 재분기할 수 없어요.")
        val revision=(policies.findFirstByWorkIdOrderByRevisionNoDesc(id)?.revisionNo ?: -1)+1
        policies.saveAndFlush(ForkPolicyHistoryEntity(id=contentKey("policy",id,revision.toString()),workId=id,revisionNo=revision,allowCreation=data.allowFork,allowPublication=data.allowForkPublication,episodeScope="all"))
        works.findById(id).orElseThrow().revision++
        return read(id,owner)
    }
    fun history(id: String,owner: String): HistoryResponse {
        access.own(id,owner)
        return HistoryResponse(versions.history(id).items,proposals.history(id,owner).items,
            policies.findAllByWorkIdOrderByRevisionNo(id).map {PolicyResponse(it.allowCreation,it.allowPublication,it.changedAt.toString())},publication.history(id).items)
    }
    private fun view(w: WorkAccessResult,public: Boolean = false): WorkResponse {
        val published=publication.publishedEpisodes(w.id).items
        val draft=if(public) null else {
            val e=episodes.findByWorkIdAndSequence(w.id,published.size+1)
            val d=e?.let {drafts.findById(it.id).orElse(null)}
            DraftResponse(d?.title ?: "새 회차",d?.content ?: "",w.revision)
        }
        return WorkResponse(w.id,w.title,w.summary,w.visibility,w.allowFork,w.allowForkPublication,w.source,published,draft)
    }

}
