package ai.storyfork.content.publication.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import jakarta.persistence.EntityManager
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.publication.entity.*
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.dto.*

@Service
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
@Transactional(transactionManager="contentTransactionManager")
class PublicationService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val episodeService: ai.storyfork.content.episode.service.EpisodeService,
    private val episodes: EpisodeRepository,
    private val current: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val events: PublicationEventRepository,
    private val visibility: WorkPublicationHistoryRepository,
    private val rights: WorkRightsDeclarationRepository,
    private val drafts: EpisodeDraftRepository,
    private val works: WorkRepository,
    private val policies: ForkPolicyHistoryRepository,
    private val selectedPolicyEpisodes: ForkPolicyEpisodeRepository,
    @Qualifier("contentEntityManager") private val em: EntityManager,
) {

    fun publishedEpisodes(id: String): PublishedEpisodeListResponse {
        em.flush()
        val rows=current.findAllByWorkIdOrderBySequence(id)
        rows.forEach(em::refresh)
        val byId=versions.findAllById(rows.mapNotNull {it.publishedVersionId}).associateBy {it.id}
        return PublishedEpisodeListResponse(rows.mapNotNull { row -> byId[row.publishedVersionId]?.let {v ->
            PublishedEpisodeResponse(row.sequence,v.revisionNo,v.contentVersionId,v.title,v.content,row.inherited)
        }})
    }
    fun history(id: String): PublicationListResponse {
        val numbers=episodes.findAllByWorkIdOrderBySequence(id).associateBy {it.id}
        val vs=versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(numbers.keys).associateBy {it.id}
        return PublicationListResponse(events.findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(vs.keys)
            .filter {it.action=="publish" && it.outcome=="applied"}.map {p ->
                val v=vs.getValue(p.episodeVersionId)
                PublicationResponse(numbers.getValue(v.episodeId).sequence,v.contentVersionId,p.occurredAt.toString())
            })
    }
    fun publishEpisode(id: String, owner: String, number: Int, data: PublishRequest): EpisodeResponse {
        val w=access.own(id,owner)
        val e=episodeService.read(id,owner,number)
        checkContent(!e.inherited,403,"원작 기준 회차는 수정할 수 없어요.")
        checkContent(e.draft.revision==data.revision,409,"다른 편집이 저장됐어요. 최신 원고를 불러와 주세요.")
        val v=e.versions.find {it.id==data.versionId} ?: throw ContentFailure(409,"이 회차의 저장 버전을 먼저 선택해 주세요.")
        checkContent(data.rightsConfirmed && v.body.isNotBlank(),message="공개 권리와 저장된 원고를 확인해 주세요.")
        checkContent(number<=publishedEpisodes(id).items.size+1,409,"앞 회차부터 순서대로 공개해 주세요.")
        checkForkPublication(w)
        apply(id,owner,number,v.id)
        return episodeService.read(id,owner,number)
    }
    fun publishCurrent(id: String, owner: String, data: PublishRequest) {
        val w=access.own(id,owner);access.requireRevision(w,data.revision)
        val number=publishedEpisodes(id).items.size+1
        val episode=episodes.findByWorkIdAndSequence(id,number) ?: throw ContentFailure(409,"현재 작성 회차가 없어요.")
        val v=data.versionId?.let { versions.findByEpisodeIdAndContentVersionId(episode.id,it) }
        checkContent(v!=null && v.isSaved,409,"현재 작성 회차의 저장 버전을 명시적으로 선택해 주세요.")
        checkContent(data.rightsConfirmed && v!!.content.isNotBlank(),message="원고를 작성하고 공개 권리를 확인해 주세요.")
        checkForkPublication(w)
        apply(id,owner,number,v!!.contentVersionId)
        if(w.source==null) {
            val last=policies.findFirstByWorkIdOrderByRevisionNoDesc(id)
            if(last==null || last.allowCreation!=data.allowFork || last.allowPublication!=data.allowForkPublication) {
                val revision=(last?.revisionNo ?: -1)+1
                val policyId=contentKey("policy",id,revision.toString())
                policies.saveAndFlush(ForkPolicyHistoryEntity(id=policyId,workId=id,allowCreation=data.allowFork,allowPublication=data.allowForkPublication,revisionNo=revision,episodeScope=last?.episodeScope ?: "all",startEpisodeId=last?.startEpisodeId))
                if(last?.episodeScope=="selected") selectedPolicyEpisodes.saveAll(selectedPolicyEpisodes.findAllByPolicyHistoryId(last.id).map {ForkPolicyEpisodeEntity(policyId,it.episodeId,id)})
            }
        }
        val next=number+1
        val row=episodes.findByWorkIdAndSequence(id,next) ?: episodes.saveAndFlush(EpisodeEntity(id=episodeId(id,next),workId=id,sequence=next))
        val d=drafts.findById(row.id).orElse(null) ?: EpisodeDraftEntity(episodeId=row.id,title="새 회차",content="")
        d.editRevision=works.findById(id).orElseThrow().revision
        drafts.save(d)
    }
    private fun checkForkPublication(w: WorkAccessResult) {
        if(w.source!=null && w.visibility!="public") checkContent(access.get(w.source.workId).allowForkPublication,403,"원작이 분기 작품의 최초 공개를 허용하지 않아요.")
    }
    private fun apply(id: String, owner: String, number: Int, version: String) {
        val row=episodes.findByWorkIdAndSequence(id,number) ?: throw ContentFailure(404,"회차를 찾을 수 없어요.")
        val v=versions.findByEpisodeIdAndContentVersionId(row.id,version) ?: throw ContentFailure(409,"저장 버전을 확인해 주세요.")
        events.saveAndFlush(PublicationEventEntity(id=contentId(),episodeVersionId=v.id,actorId=owner,action="publish",outcome="applied",triggerKind="manual"))
        val currentVisibility=visibility.findFirstByWorkIdOrderByRevisionNoDesc(id)
        if(currentVisibility?.visibility!="public") visibility.save(WorkPublicationHistoryEntity(id=contentId(),workId=id,revisionNo=(currentVisibility?.revisionNo ?: -1)+1,visibility="public"))
        rights.save(WorkRightsDeclarationEntity(id=contentId(),workId=id,memberId=owner,noticeVersion="publication-rights-v1",response="confirmed"))
        drafts.findById(row.id).orElse(null)?.let {it.editRevision++}
        works.findById(id).orElseThrow().revision++
        em.flush()
    }

}
