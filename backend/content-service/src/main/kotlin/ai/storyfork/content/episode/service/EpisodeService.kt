package ai.storyfork.content.episode.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import jakarta.persistence.EntityManager
import java.time.Instant
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.episode_version.service.dto.*

@Service
@Transactional(transactionManager="contentTransactionManager")
class EpisodeService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val works: WorkRepository,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val current: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val imageRepositories: org.springframework.beans.factory.ObjectProvider<ai.storyfork.content.attachment.repository.ContentImageRepository>,
    @Qualifier("contentEntityManager") private val em: EntityManager,
    private val forks: ai.storyfork.content.fork.repository.ForkRepository,
    private val checkpointEpisodes: CheckpointEpisodeRepository,
    private val publicationEvents: ai.storyfork.content.publication.repository.PublicationEventRepository,
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
        checkContent(ai.storyfork.content.episode.domain.EpisodeMutationPolicy.acceptsRevision(data.revision,before.draft.revision),409,"다른 편집이 저장됐어요. 입력을 보관하고 최신 원고를 다시 불러와 주세요.")
        validate(data.title,data.body)
        requireImageReferences(id,number,data.body)
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
        val candidates=ai.storyfork.content.episode.domain.EpisodeMutationPolicy.candidates(number,list(id,owner).items.map {it.number},protected)
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
        checkContent(ai.storyfork.content.episode.domain.EpisodeMutationPolicy.canDelete(before.inherited,!imagesAbsent(id,number) || episodes.referenceCount(e.id)>0,following),409,"참조 없는 마지막 회차만 삭제할 수 있어요. 이미지 참조가 있거나 확인할 수 없으면 삭제가 제한돼요.")
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
    /** 원고 저장·복원·발행에서 동일한 이미지 참조 권한을 확인한다. 첨부 비활성 시 참조는 거부한다. */
    fun requireImageReferences(work: String, number: Int, body: String) {
        // README 계약: 원고 이미지는 업로드 참조([[image:<UUID>]])만 허용하고 본문 인라인 data:image는 거절한다.
        checkContent(!body.contains("data:image",ignoreCase=true),422,"원고에 이미지를 직접 넣을 수 없어요. 이미지 업로드를 사용해 주세요.")
        val ids=Regex("\\[\\[image:([^\\]]+)\\]\\]").findAll(body).map {it.groupValues[1]}.toSet()
        if(ids.isEmpty()) return
        val images=imageRepositories.getIfAvailable()
        checkContent(images!=null,422,"사용할 수 없는 원고 이미지가 포함되어 있어요.")
        ids.forEach { id ->
            val image=images!!.findById(id).orElse(null)
            checkContent(image!=null && permitsImageReference(work,number,image),422,"사용할 수 없는 원고 이미지가 포함되어 있어요.")
        }
    }
    /** Fork의 상속 권한은 원작의 현재 원고가 아닌 생성 시 고정된 원본 회차·버전으로 증명한다. */
    fun permitsImageReference(work: String, number: Int, image: ai.storyfork.content.attachment.entity.ContentImage): Boolean {
        if(number<1 || image.episodeNo!=number) return false
        if(image.workId==work) return true
        val fork=forks.findById(work).orElse(null) ?: return false
        if(image.workId!=fork.sourceWorkId) return false
        val source=episodes.findByWorkIdAndSequence(fork.sourceWorkId,number) ?: return false
        val pinned=checkpointEpisodes.findById(ai.storyfork.content.episode_version.entity.CheckpointEpisodeEntity.Key(fork.sourceCheckpointId,source.id)).orElse(null) ?: return false
        if(pinned.sourceWorkId!=fork.sourceWorkId) return false
        val version=versions.findById(pinned.episodeVersionId).orElse(null) ?: return false
        return version.episodeId==source.id && "[[image:${image.id}]]" in version.content
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
        // DEC-43: 체크포인트는 저장 버전의 발행(publish/replace/republish·applied) 기록이다. 되돌리기는 같은 버전을 다시 발행하므로 버전당 최초 발행 한 건만 센다.
        val savedList=saved.values.flatten();val versionById=savedList.associateBy {it.id}
        val checkpointLog=publicationEvents.findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(savedList.map {it.id})
            .filter {it.action in setOf("publish","replace","republish") && it.outcome=="applied"}.distinctBy {it.episodeVersionId}.groupBy {versionById.getValue(it.episodeVersionId).episodeId}
        return rows.mapNotNull { row ->
            val draft=draftById[row.id];val p=published[row.publishedVersionId]
            val floor=entities[row.id]?.draftRevisionFloor ?: -1
            if(draft==null && p==null && saved[row.id].isNullOrEmpty() && floor<0) null else EpisodeResponse(row.sequence,
                DraftResponse(draft?.title ?: p?.title ?: saved[row.id]?.lastOrNull()?.title ?: "새 회차",draft?.content ?: if(floor<0) p?.content.orEmpty() else "",draft?.editRevision ?: maxOf(0,floor)),
                saved[row.id].orEmpty().map { VersionResponse(it.contentVersionId,it.title,it.content,it.revisionNo,row.sequence,it.createdAt.toString()) },
                p?.contentVersionId,row.inherited,draft?.updatedAt?.toString(),hasDraft=draft!=null,publicationStatus=row.publicationStatus,
                checkpoints=checkpointLog[row.id].orEmpty().map { EpisodeCheckpointResponse(versionById.getValue(it.episodeVersionId).contentVersionId,it.occurredAt.toString(),it.episodeVersionId==row.publishedVersionId) })
        }
    }
    private fun missing(): Nothing = throw ContentFailure(404,"회차를 찾을 수 없어요.")

}
