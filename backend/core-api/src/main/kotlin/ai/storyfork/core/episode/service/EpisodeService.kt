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
        drafts.save(EpisodeDraftEntity(episodeId=e.id,title=data.title.trim(),content="",editRevision=0))
        works.findById(id).orElseThrow().revision++
        return readCurrent(id,number)
    }
    fun update(id: String, owner: String, number: Int, data: DraftRequest): EpisodeResponse {
        access.own(id,owner)
        val before=readCurrent(id,number)
        checkContent(!before.inherited,403,"원작 기준 회차는 수정할 수 없어요.")
        checkContent(before.draft.revision==data.revision,409,"다른 편집이 저장됐어요. 입력을 보관하고 최신 원고를 다시 불러와 주세요.")
        validate(data.title,data.body)
        val e=episodes.findByWorkIdAndSequence(id,number) ?: missing()
        val d=drafts.findById(e.id).orElse(null) ?: EpisodeDraftEntity(episodeId=e.id)
        d.title=data.title.trim(); d.content=data.body; d.editRevision=data.revision+1; d.updatedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        drafts.save(d)
        works.findById(id).orElseThrow().revision++
        return readCurrent(id,number)
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
        val published=versions.findAllById(rows.mapNotNull {it.publishedVersionId}).associateBy {it.id}
        return rows.mapNotNull { row ->
            val draft=draftById[row.id];val p=published[row.publishedVersionId]
            if(draft==null && p==null) null else EpisodeResponse(row.sequence,
                DraftResponse(draft?.title ?: p!!.title,draft?.content ?: p!!.content,draft?.editRevision ?: 0),
                saved[row.id].orEmpty().map { VersionResponse(it.contentVersionId,it.title,it.content,it.revisionNo,row.sequence,it.createdAt.toString()) },
                p?.contentVersionId,row.inherited,draft?.updatedAt?.toString())
        }
    }
    private fun missing(): Nothing = throw ContentFailure(404,"회차를 찾을 수 없어요.")

}
