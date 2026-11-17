package ai.storyfork.content.world.service

import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.service.EpisodeService
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

/** 기존 소유자 회차 조회와 같은 Content transaction 안에서 최신 저장본 전체를 고정한다. */
@Service
class ManuscriptBuildSnapshot(
    private val episodes:EpisodeService,private val current:EpisodeCurrentRepository,
    @Qualifier("contentTransactions") private val transaction:TransactionTemplate,
) {
    fun read(workId:String,owner:String):ManuscriptBuildInput = checkNotNull(transaction.execute {
        // list는 실제 소유자 검증 및 작품 잠금을 수행한다. 발행본/수정 중 초안으로 대체하지 않는다.
        val visible=episodes.list(workId,owner).items
        val ids=current.findAllByWorkIdOrderBySequence(workId).associate { it.sequence to it.id }
        ManuscriptBuildInput(visible.map { episode ->
            require(!episode.inherited) { "Fork 상속 회차는 최초 원고 구축 대상이 아닙니다." }
            val saved=requireNotNull(episode.versions.lastOrNull()) { "모든 회차의 원고를 먼저 저장하세요." }
            require(saved.episode==episode.number)
            ManuscriptBuildSource(episode.number,requireNotNull(ids[episode.number]),saved.id,saved.title,saved.body)
        })
    })
}
