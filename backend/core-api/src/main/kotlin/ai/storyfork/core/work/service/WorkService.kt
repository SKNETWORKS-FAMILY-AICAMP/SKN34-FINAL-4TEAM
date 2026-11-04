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
import ai.storyfork.core.work.domain.*
import org.springframework.dao.DataIntegrityViolationException

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
    private val genreRows: GenreRepository,
    private val workGenres: WorkGenreRepository,
    private val hashtagRows: WorkHashtagRepository,
    private val rightsRows: WorkRightsDeclarationRepository,
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
        return WorkListResponse(rows.mapNotNull {
            val w=access.get(it.id)
            if(w.visibility=="public") view(w,true) else null
        })
    }
    fun read(id: String,owner: String): WorkResponse = view(access.own(id,owner))
    fun publicRead(id: String): WorkResponse = view(access.published(id),true)
    fun create(owner: String,data: CreateWorkRequest): WorkResponse {
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.summary.length<=2000,message="작품 제목과 소개를 확인해 주세요.")
        val registered=data.creationType!=null || data.genres.isNotEmpty() || data.hashtags.isNotEmpty() || data.rightsConfirmed!=null
        val meta=if(registered) validateWorkMetadata(data.creationType,data.genres,data.hashtags,data.rightsConfirmed==true) else null
        val genreIds=meta?.let {
            val found=genreRows.findAllByNameIn(it.genres)
            checkContent(found.size==it.genres.size,message="승인된 장르 목록에서 서로 다른 장르를 골라 주세요.")
            found
        }.orEmpty()
        members.ensure(owner)
        val id=contentId()
        worlds.saveAndFlush(WorldEntity(id=id,ownerId=owner,name=data.title.trim()+" 설정집"))
        works.saveAndFlush(WorkEntity(id=id,ownerId=owner,title=data.title.trim(),description=data.summary.trim(),originKind="original",revision=0,creationType=meta?.type?.code ?: "original"))
        workWorlds.saveAndFlush(WorkWorldHistoryEntity(id=contentKey("work-world",id,"0"),workId=id,worldId=id,revisionNo=0))
        visibility.saveAndFlush(WorkPublicationHistoryEntity(id=contentKey("work-publication",id,"0"),workId=id,revisionNo=0,visibility="private"))
        if(meta!=null) {
            workGenres.saveAll(genreIds.map {WorkGenreEntity(workId=id,genreId=it.id)})
            hashtagRows.saveAll(meta.hashtags.mapIndexed {i,tag->WorkHashtagEntity(id=contentKey("work-hashtag",id,i.toString()),workId=id,tag=tag,position=i)})
            rightsRows.save(WorkRightsDeclarationEntity(id=contentId(),workId=id,memberId=owner,noticeVersion="registration-rights-v1",response="confirmed"))
        }
        val episode=episodes.saveAndFlush(EpisodeEntity(id=episodeId(id,1),workId=id,sequence=1))
        drafts.saveAndFlush(EpisodeDraftEntity(episodeId=episode.id,title="새 회차",content="",editRevision=0))
        return read(id,owner)
    }
    fun update(id: String,owner: String,data: UpdateWorkRequest): WorkResponse {
        val w=access.own(id,owner);access.requireRevision(w,data.revision)
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.summary.length<=2000,message="작품 제목과 소개를 확인해 주세요.")
        val row=works.findById(id).orElseThrow()
        row.title=data.title.trim();row.description=data.summary.trim();row.revision++
        works.saveAndFlush(row)
        return read(id,owner)
    }
    /** 발행·저장 버전·세계관 설정 등 이력이 걸린 작품은 DB 제약으로 막히며 전체를 되돌리고 409를 반환한다. */
    fun delete(id: String,owner: String) {
        val w=access.own(id,owner)
        checkContent(w.source==null,409,"분기 작품은 아직 삭제할 수 없어요.")
        val rows=episodes.findAllByWorkIdOrderBySequence(id)
        try {
            drafts.deleteAllById(rows.map {it.id})
            episodes.deleteAll(rows)
            workGenres.deleteAllByWorkId(id)
            hashtagRows.deleteAllByWorkId(id)
            rightsRows.deleteAllByWorkId(id)
            workWorlds.deleteAllByWorkId(id)
            visibility.deleteAllByWorkId(id)
            policies.deleteAllByWorkId(id)
            works.deleteById(id)
            worlds.deleteById(w.worldId)
            works.flush()
        } catch(e: DataIntegrityViolationException) {
            throw ContentFailure(409,"발행·저장 이력이 있거나 분기된 작품은 삭제할 수 없어요.")
        }
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
        val row=works.findById(w.id).orElseThrow()
        val genres=genreRows.findAllById(workGenres.findAllByWorkId(w.id).map {it.genreId}).map {it.name}.sortedBy {WORK_GENRES.indexOf(it)}
        val tags=hashtagRows.findAllByWorkIdOrderByPosition(w.id).map {it.tag}
        val type=CreationType.entries.first {it.code==row.creationType}.name
        return WorkResponse(w.id,w.title,w.summary,w.visibility,w.allowFork,w.allowForkPublication,w.source,published,draft,hasWritingEpisode=!public && episodes.countWritingAt(w.id,published.size+1)>0,creationType=type,genres=genres,hashtags=tags)
    }

}
