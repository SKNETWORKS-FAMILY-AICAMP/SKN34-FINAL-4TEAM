package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
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
}
