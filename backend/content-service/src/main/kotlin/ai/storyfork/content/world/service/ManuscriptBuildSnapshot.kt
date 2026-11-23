package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

/** 기존 소유자 회차 조회와 같은 Content transaction 안에서 최신 저장본 전체를 고정한다. */
@Service
class ManuscriptBuildSnapshot(
    private val episodes:EpisodeService,private val current:EpisodeCurrentRepository,private val versions:EpisodeVersionRepository,
    @Qualifier("contentTransactions") private val transaction:TransactionTemplate,
) {
    fun read(workId:String,owner:String):ManuscriptBuildInput = checkNotNull(transaction.execute {
        // list는 실제 소유자 검증 및 작품 잠금을 수행한다. 발행본/수정 중 초안으로 대체하지 않는다.
        // 발행과 작품 생성이 만드는 끝의 빈 다음 회차 초안은 대상이 아니다. 중간의 미저장·상속 회차는 사유와 함께 422다.
        val visible=episodes.list(workId,owner).items.dropLastWhile { it.versions.isEmpty() }
        checkContent(visible.isNotEmpty(),422,"저장한 회차가 있어야 세계관을 만들 수 있어요.")
        val ids=current.findAllByWorkIdOrderBySequence(workId).associate { it.sequence to it.id }
        ManuscriptBuildInput(visible.map { episode ->
            checkContent(!episode.inherited,422,"Fork로 이어받은 회차가 있는 작품은 원고로 세계관을 만들 수 없어요.")
            val saved=episode.versions.lastOrNull() ?: throw ContentFailure(422,"${episode.number}화에 저장한 원고가 없어요. 모든 회차의 원고를 저장한 뒤 다시 시작해 주세요.")
            require(saved.episode==episode.number)
            ManuscriptBuildSource(episode.number,requireNotNull(ids[episode.number]),saved.id,saved.title,saved.body)
        })
    })

    /**
     * 업데이트 작업(발행 회차로 세계관 초안 업데이트, 2026-11-22)의 입력이다. 발행본이 있는 회차(Fork 상속 제외) 중 [wanted]가 고른 번호의 **발행 버전**이며
     * 저장만 한 버전·초안은 읽지 않는다. 고를 회차가 없으면 null이다.
     */
    fun readPublished(workId:String,wanted:(Int)->Boolean):ManuscriptBuildInput? = transaction.execute {
        val rows=current.findAllByWorkIdOrderBySequence(workId).filter { !it.inherited && it.publishedVersionId!=null && wanted(it.sequence) }
        val published=versions.findAllById(rows.map { requireNotNull(it.publishedVersionId) }).associateBy { it.id }
        rows.takeIf { it.isNotEmpty() }?.let { ManuscriptBuildInput(it.map { row ->
            val version=published.getValue(requireNotNull(row.publishedVersionId))
            ManuscriptBuildSource(row.sequence,row.id,version.contentVersionId,version.title,version.content)
        }) }
    }
}
