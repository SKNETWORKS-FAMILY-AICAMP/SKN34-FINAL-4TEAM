package ai.storyfork.core.episode.service

import ai.storyfork.core._common.exception.*
import ai.storyfork.core._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import jakarta.persistence.EntityManager
import java.time.Instant
import ai.storyfork.core.work.repository.*
import ai.storyfork.core.episode.entity.*
import ai.storyfork.core.episode.repository.*
import ai.storyfork.core.episode.service.dto.*
import ai.storyfork.core.episode_version.repository.*
import ai.storyfork.core.episode_version.service.dto.*

@Service
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
@Transactional(transactionManager="contentTransactionManager")
class EpisodeService(
    private val access: ai.storyfork.core.work.service.WorkAccessService,
    private val works: WorkRepository,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val current: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val imageRepositories: org.springframework.beans.factory.ObjectProvider<ai.storyfork.core.attachment.repository.ContentImageRepository>,
    @Qualifier("contentEntityManager") private val em: EntityManager,
) {

    fun list(id: String, owner: String): EpisodeListResponse {
        access.own(id,owner)
        return EpisodeListResponse(assemble(current.findAllByWorkIdOrderBySequence(id)))
    }
    fun read(id: String, owner: String, number: Int): EpisodeResponse {
        access.own(id,owner)
        return readCurrent(id,number)
    }
    fun create(id: String, owner: String, data: CreateEpisodeRequest): EpisodeResponse {
        access.own(id,owner)
        validate(data.title,"")
        val last=list(id,owner).items.maxOfOrNull { it.number } ?: 0
        checkContent(last<Int.MAX_VALUE,409,"회차 번호를 더 생성할 수 없어요.")
        val number=last+1
        val e=ensure(id,number)
        drafts.save(EpisodeDraftEntity(episodeId=e.id,title=data.title.trim(),content="",editRevision=works.findById(id).orElseThrow().deletedEpisodeRevision))
        works.findById(id).orElseThrow().revision++
        return readCurrent(id,number)
    }
    fun update(id: String, owner: String, number: Int, data: DraftRequest): EpisodeResponse {
        access.own(id,owner)
        val before=readCurrent(id,number)
        checkContent(!before.inherited,403,"원작 기준 회차는 수정할 수 없어요.")
        checkContent(ai.storyfork.core.episode.domain.EpisodeMutationPolicy.acceptsRevision(data.revision,before.draft.revision),409,"다른 편집이 저장됐어요. 입력을 보관하고 최신 원고를 다시 불러와 주세요.")
        validate(data.title,data.body)
        checkContent(!data.body.contains("data:image",ignoreCase=true),message="Inline images are not allowed")
        val markers=Regex("\\[\\[image:([^\\]]*)]]").findAll(data.body).map {it.groupValues[1]}.toList()
        checkContent(markers.size<=10,message="Too many image references")
        for(marker in markers) {
            val image=imageRepositories.getIfAvailable()?.findById(marker)?.orElse(null)
            checkContent(image!=null && image.workId==id && image.episodeNo==number,message="Invalid episode image reference")
        }
        val e=episodes.findByWorkIdAndSequence(id,number) ?: missing()
        val d=drafts.findById(e.id).orElse(null) ?: EpisodeDraftEntity(episodeId=e.id)
        d.title=data.title.trim(); d.content=data.body; d.editRevision=data.revision+1; d.updatedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        drafts.save(d)
        works.findById(id).orElseThrow().revision++
        return readCurrent(id,number)
    }
    /** 번호 변경은 실행하지 않고 현재 참조 기준의 후보 구간만 반환한다. */
    fun orderScope(id: String, owner: String, number: Int): EpisodeOrderScopeResponse {
        read(id,owner,number)
        val rows=episodes.findAllByWorkIdOrderBySequence(id)
        val protected=rows.filter { !imagesAbsent(id,it.sequence) || episodes.referenceCount(it.id)>0 }.map {it.sequence}.toSet()
        val candidates=ai.storyfork.core.episode.domain.EpisodeMutationPolicy.candidates(number,list(id,owner).items.map {it.number},protected)
        return EpisodeOrderScopeResponse(number,candidates,listOf("이미지 참조 또는 참조 확인 불가·저장 버전·설정 공개 범위·AI·Fork 참조를 넘는 이동 제한", "후보 조회만 제공하며 실제 순서 변경과 최종 정책은 미확정입니다."))
    }
    fun deleteDraft(id: String, owner: String, number: Int, revision: Int) {
        val before=read(id,owner,number)
        checkContent(!before.inherited,403,"원작 기준 회차는 삭제할 수 없어요.")
        checkContent(before.draft.revision==revision,409,"초안이 변경됐어요. 다시 불러와 주세요.")
        val e=episodes.findByWorkIdAndSequence(id,number) ?: missing()
        val d=drafts.findById(e.id).orElseThrow { ContentFailure(404,"삭제할 초안이 없어요.") }
        checkContent(revision<Int.MAX_VALUE,409,"편집 번호 한도에 도달했어요.")
        e.draftRevisionFloor=revision+1
        drafts.delete(d)
        works.findById(id).orElseThrow().revision++
        em.flush()
    }
    fun deleteEpisode(id: String, owner: String, number: Int, revision: Int) {
        val before=read(id,owner,number)
        checkContent(!before.inherited,403,"원작 기준 회차는 삭제할 수 없어요.")
        checkContent(before.draft.revision==revision,409,"회차가 변경됐어요. 다시 불러와 주세요.")
        val e=episodes.findByWorkIdAndSequence(id,number) ?: missing()
        val following=list(id,owner).items.any {it.number>number}
        checkContent(ai.storyfork.core.episode.domain.EpisodeMutationPolicy.canDelete(before.inherited,!imagesAbsent(id,number) || episodes.referenceCount(e.id)>0,following),409,"참조 없는 마지막 회차만 삭제할 수 있어요. 이미지 참조가 있거나 확인할 수 없으면 삭제가 제한돼요.")
        drafts.findById(e.id).ifPresent { drafts.delete(it) }
        drafts.flush()
        episodes.delete(e)
        try { episodes.flush() } catch (_: org.springframework.dao.DataIntegrityViolationException) {
            throw ContentFailure(409,"회차를 참조하는 기록이 있어 삭제하지 못했어요.")
        }
        val work=works.findById(id).orElseThrow()
        work.revision=maxOf(work.revision,revision)+1
        work.deletedEpisodeRevision=work.revision
    }
    private fun imagesAbsent(work: String, number: Int): Boolean {
        val repository=imageRepositories.getIfAvailable() ?: return false
        return try { repository.countByWorkIdAndEpisodeNo(work,number)==0L }
        catch (_: org.springframework.dao.DataAccessException) { throw ContentFailure(503,"이미지 참조를 확인하지 못했어요. 삭제하지 않았으니 나중에 다시 시도해 주세요.") }
    }
    private fun ensure(work: String, number: Int): EpisodeEntity = episodes.findByWorkIdAndSequence(work,number)
        ?: episodes.saveAndFlush(EpisodeEntity(id=episodeId(work,number),workId=work,sequence=number))
    private fun validate(title: String, body: String) = checkContent(title.isNotBlank() && title.length<=120 && body.length<=40000,message="제목은 120자, 원고는 40,000자 이내로 작성해 주세요.")
    private fun readCurrent(id: String, number: Int): EpisodeResponse {
        em.flush()
        val row=current.findByWorkIdAndSequence(id,number) ?: missing()
        em.refresh(row)
        return assemble(listOf(row)).singleOrNull() ?: missing()
    }
    private fun assemble(rows: List<EpisodeCurrentEntity>): List<EpisodeResponse> {
        if(rows.isEmpty()) return emptyList()
        val draftById=drafts.findAllById(rows.map {it.id}).associateBy {it.episodeId}
        val saved=versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(rows.map {it.id}).filter {it.isSaved}.groupBy {it.episodeId}
        val entities=episodes.findAllById(rows.map {it.id}).associateBy {it.id}
        val published=versions.findAllById(rows.mapNotNull {it.publishedVersionId}).associateBy {it.id}
        return rows.mapNotNull { row ->
            val draft=draftById[row.id];val p=published[row.publishedVersionId]
            val floor=entities[row.id]?.draftRevisionFloor ?: -1
            if(draft==null && p==null && saved[row.id].isNullOrEmpty() && floor<0) null else EpisodeResponse(row.sequence,
                DraftResponse(draft?.title ?: p?.title ?: saved[row.id]?.lastOrNull()?.title ?: "새 회차",draft?.content ?: if(floor<0) p?.content.orEmpty() else "",draft?.editRevision ?: maxOf(0,floor)),
                saved[row.id].orEmpty().map { VersionResponse(it.contentVersionId,it.title,it.content,it.revisionNo,row.sequence,it.createdAt.toString()) },
                p?.contentVersionId,row.inherited,draft?.updatedAt?.toString(),hasDraft=draft!=null)
        }
    }
    private fun missing(): Nothing = throw ContentFailure(404,"회차를 찾을 수 없어요.")

}
