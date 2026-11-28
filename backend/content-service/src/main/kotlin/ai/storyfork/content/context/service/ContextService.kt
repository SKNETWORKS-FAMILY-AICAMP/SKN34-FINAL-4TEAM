package ai.storyfork.content.context.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content.context.domain.RecentSource
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.world.service.dto.toDomain
import ai.storyfork.content.world.service.dto.toPayload
import ai.storyfork.content.world.domain.selectSettings
import ai.storyfork.content.context.domain.sourceExcerpts

@Service
@Transactional(transactionManager="contentTransactionManager")
class ContextService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val world: ai.storyfork.content.world.service.WorldService,
    private val publication: ai.storyfork.content.publication.service.PublicationService,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val mapper: tools.jackson.databind.json.JsonMapper,
    @Value("\${storyfork.writing.recent-source-units:1500}") private val recentSourceUnits: Int = 1500,
) {

    fun read(id: String,owner: String?,request: ContextRequest): StoryContextResponse = select(id,owner,request,false)

    fun readForDraft(id: String, owner: String, request: ContextRequest,
                     draftEpisode: Int? = null, basisVersionId: String? = null): StoryContextResponse =
        select(id,owner,request,true,draftEpisode,basisVersionId)

    private fun select(id: String,owner: String?,request: ContextRequest, forkDraft: Boolean, draftEpisode: Int? = null, basisVersionId: String? = null): StoryContextResponse {
        val basis=request.episode ?: throw ContentFailure(422,"기준 회차를 선택해 주세요.")
        val query=request.query.take(2000)
        val character=request.character.take(80)
        val w=if(owner==null) access.published(id) else access.own(id,owner)
        val published=publication.publishedEpisodes(id).items.let {if(owner==null) w.readerEpisodes(it) else it}
        val max=publication.nextEpisodeNumber(id)
        checkContent(if(owner==null) published.any {it.number==basis} else basis in 1..max,message="공개 회차 또는 현재 작성 회차를 선택해 주세요.")
        if (basisVersionId != null) checkContent(published.any { it.number == basis && it.versionId == basisVersionId },
            409,"집필 기준 판본이 변경됐어요.")
        val settings=if(!request.includeSettings) emptyList() else {
            val following=w.source!=null && world.isFollowingForContext(id)
            selectSettings(world.historyForContext(id).items.map {it.toDomain()},basis,owner==null || following,character)
        }
        val draft=if(owner!=null && character.isEmpty() && basis==max) {
            episodes.findByWorkIdAndSequence(id,max)?.let {drafts.findById(it.id).orElse(null)?.content} ?: ""
        } else ""
        val budget=48000-draft.length-settings.sumOf {it.content.length+it.name.length+it.evidence.length+it.knownBy.sumOf(String::length)+it.tags.sumOf(String::length)+700}
        checkContent(budget>=0,message="설정과 현재 원고가 문맥 한도를 넘어요. 범위를 좁혀 주세요. 저장본은 보존됩니다.")
        val eligible=published.filter {it.number<=basis}
        val selected=if(character.isEmpty()) eligible.takeLast(3) else emptyList()
        val excerpts=selected.map {e -> ContextEpisodeResponse(e.number,e.version,e.versionId,e.title,e.body.length,
            sourceExcerpts(e.body,minOf(10000,budget/maxOf(1,selected.size)),query).map {ExcerptResponse(it.start,it.end,it.text)})}
        // A product fork pins a published episode ending, not an arbitrary character offset.
        val origin = w.source
        val recent = if (forkDraft && origin != null && character.isEmpty() &&
            (draftEpisode == null || draftEpisode == max) && max == origin.episode + 1 && basis >= origin.episode) {
            val pinned = eligible.singleOrNull { it.number == origin.episode }
                ?: throw ContentFailure(409, "포크 기준 회차의 발행본이 없어요.")
            checkContent(pinned.inherited && pinned.versionId == origin.pinnedContentVersionId && pinned.versionId.isNotBlank(),
                409, "포크 원문 판본이 기준과 달라요.")
            RecentSource.select("original", pinned.number, pinned.versionId, pinned.body, pinned.body.length, recentSourceUnits)
        } else null
        val result=StoryContextResponse(w.title,if(character.isEmpty()) w.summary else "",basis,character,settings.map {it.toPayload()},draft,excerpts,
            SelectionResponse(eligible.sumOf {it.body.length}-excerpts.sumOf {e -> e.excerpts.sumOf {it.text.length}},eligible.size),recent)
        checkContent(mapper.writeValueAsString(result).length<=60000,message="문맥 한도를 넘어요. 회차 또는 인물 범위를 좁혀 주세요.")
        return result
    }

}
