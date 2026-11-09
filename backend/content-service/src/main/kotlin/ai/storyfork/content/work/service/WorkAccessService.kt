package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import jakarta.persistence.EntityManager
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.service.dto.*

@Service
@Transactional(transactionManager="contentTransactionManager")
class WorkAccessService(
    private val works: WorkRepository,
    private val worlds: WorkWorldHistoryRepository,
    private val visibility: WorkPublicationHistoryRepository,
    private val policies: ForkPolicyHistoryRepository,
    private val selectedPolicyEpisodes: ForkPolicyEpisodeRepository,
    private val forks: ForkRepository,
    private val checkpoints: CheckpointRepository,
    private val episodes: EpisodeRepository,
    private val versions: EpisodeVersionRepository,
    @Qualifier("contentEntityManager") private val em: EntityManager,
) {

    fun get(id: String): WorkAccessResult {
        val w=works.findById(id).orElse(null) ?: throw ContentFailure(404,"작품을 찾을 수 없어요.")
        val policy=policies.findFirstByWorkIdOrderByRevisionNoDesc(id)
        val f=forks.findById(id).orElse(null)
        val source=f?.let {
            // 원작이 삭제된 Fork는 원작·체크포인트를 읽지 않고 Fork에 남긴 기준 정보로 응답한다.
            if(it.sourceDeletedAt!=null) return@let SourceResponse("",it.sourceTitle,it.basisEpisode!!,it.basisVersion!!,it.direction,null,it.conditionsConfirmedAt?.toString(),true)
            val cp=checkpoints.findById(it.sourceCheckpointId!!).orElseThrow()
            val episode=episodes.findById(cp.episodeId).orElseThrow()
            val version=versions.findById(cp.basisEpisodeVersionId).orElseThrow()
            SourceResponse(it.sourceWorkId!!,it.sourceTitle,episode.sequence,version.revisionNo,it.direction,
                it.confirmedPolicyHistoryId?.let { pid -> policies.findById(pid).orElseThrow().revisionNo },it.conditionsConfirmedAt?.toString())
        }
        return WorkAccessResult(w.id,w.ownerId,w.title,w.description,w.revision,
            worlds.findFirstByWorkIdOrderByRevisionNoDesc(id)?.worldId ?: throw ContentFailure(409,"작품의 세계관 연결이 없어요."),
            visibility.findFirstByWorkIdOrderByRevisionNoDesc(id)?.visibility ?: "private",
            policy?.allowCreation ?: false,policy?.allowPublication ?: false,source,w.restricted)
    }
    fun forkable(id: String, published: List<Int>): List<Int> {
        val policy=policies.findFirstByWorkIdOrderByRevisionNoDesc(id) ?: return emptyList()
        val selected=if(policy.episodeScope=="selected") selectedPolicyEpisodes.findAllByPolicyHistoryId(policy.id).map {it.episodeId} else emptyList()
        val rows=episodes.findAllById(selected+listOfNotNull(policy.startEpisodeId)).filter {it.workId==id}
        return ai.storyfork.content.work.domain.forkableEpisodes(policy.allowCreation,policy.episodeScope,
            rows.find {it.id==policy.startEpisodeId}?.sequence,rows.filter {it.id in selected}.map {it.sequence},published)
    }
    fun own(id: String, owner: String): WorkAccessResult {
        checkContent(owner.isNotBlank() && owner.length<=200,401,"서버 인증이 필요합니다.")
        lockScope(id)
        return get(id).also { checkContent(it.ownerId==owner,404,"작품을 찾을 수 없어요.") }
    }
    fun published(id: String): WorkAccessResult {
        return get(id).also { checkContent(it.publiclyVisible(),404,"공개 작품을 찾을 수 없어요.") }
    }
    fun lockScope(id: String) = lockScopes(listOf(id))
    fun lockScopes(ids: Collection<String>) {
        // Flush changes already protected by this transaction before refreshing cached rows.
        em.flush()
        val sources=forks.findAllById(ids)
        val scope=(ids+sources.mapNotNull {it.sourceWorkId}).distinct().sorted()
        works.lockAll(scope).forEach(em::refresh)
        sources.forEach(em::refresh)
    }
    fun requireRevision(work: WorkAccessResult, expected: Int) = checkContent(work.revision==expected,409,"원고가 변경됐어요. 최신 데이터를 불러와 주세요.")

}
