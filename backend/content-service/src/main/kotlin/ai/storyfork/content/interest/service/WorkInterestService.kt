package ai.storyfork.content.interest.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.entity.WorkInterestEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.interest.repository.WorkInterestRepository
import ai.storyfork.content.interest.service.dto.WorkInterestListResponse
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

private const val EPISODE_PUBLISHED = "content.episode.published"

/** 관심 작품 등록·해제·내 목록과, 새 회차 발행 알림 사건(outbox) 기록을 맡는다. 대상은 지금 공개 중인 작품뿐이다. */
@Service
class WorkInterestService(
    private val access: WorkAccessService,
    private val current: EpisodeCurrentRepository,
    private val interests: WorkInterestRepository,
    private val outbox: ContentEventOutboxRepository,
) {
    private fun requireMember(member: String) = checkContent(member.isNotBlank() && member.length<=200,401,"서버 인증이 필요합니다.")

    /**
     * 공개 작품을 관심 작품에 담고, 이미 담았으면 그대로 둔다(멱등). 비공개·없는 작품은 404다.
     * 저장소 호출이 각자 트랜잭션을 가져야 동시 중복 INSERT의 unique 위반을 삼켜도 다른 호출이 오염되지 않으므로 서비스 트랜잭션은 쓰지 않는다.
     */
    @Transactional(transactionManager="contentTransactionManager", propagation=Propagation.NOT_SUPPORTED)
    fun add(id: String, member: String) {
        requireMember(member)
        access.published(id)
        val key=WorkInterestEntity.Key(id,member)
        if(interests.existsById(key)) return
        try {
            interests.saveAndFlush(WorkInterestEntity(id,member,Instant.now().truncatedTo(ChronoUnit.MICROS)))
        } catch(error: DataIntegrityViolationException) {
            // 같은 회원의 동시 요청이 방금 행을 저장했다면 이미 담은 것이므로 무시한다.
            if(!interests.existsById(key)) throw error
        }
    }

    /** 관심 작품에서 빼고, 담지 않은 작품이어도 그대로 성공한다(멱등). 비공개·없는 작품은 404다. */
    fun remove(id: String, member: String) {
        requireMember(member)
        access.published(id)
        interests.deleteById(WorkInterestEntity.Key(id,member))
    }

    /** 회원 본인의 관심 작품 id를 최근 등록순으로 돌려주며, 지금은 공개가 아닌 작품은 뺀다. */
    // ponytail: 작품마다 WorkAccessService.get으로 공개 여부를 확인하는 N+1이다. 목록이 수백 건을 넘으면 한 번의 쿼리로 바꾼다.
    fun list(member: String): WorkInterestListResponse {
        requireMember(member)
        return WorkInterestListResponse(interests.findAllByMemberIdOrderByCreatedAtDescWorkIdAsc(member).map {it.workId}.filter {access.get(it).publiclyVisible()})
    }

    /**
     * 새 회차를 발행할 때 같은 트랜잭션에서 관심 회원마다(작가 본인 제외) 알림 사건 한 건씩 outbox에 쓴다.
     * 이미 발행한 회차의 재발행이거나 작품이 공개가 아니면 쓰지 않는다. 발행 이벤트를 저장하기 **전에** 불러야 새 회차인지 가려진다.
     */
    // ponytail: 관심 회원 수만큼 같은 트랜잭션에서 행을 쓴다. 수만 명이면 배치·비동기 팬아웃으로 바꾼다.
    @Transactional(transactionManager="contentTransactionManager")
    fun episodePublished(id: String, author: String, number: Int) {
        if(current.findByWorkIdAndSequence(id,number)?.publishedVersionId!=null) return
        if(!access.get(id).publiclyVisible()) return
        val now=Instant.now().truncatedTo(ChronoUnit.MICROS)
        outbox.saveAll(interests.findAllByWorkId(id).filter {it.memberId!=author}.map {
            ContentEventOutboxEntity(UUID.randomUUID(),EPISODE_PUBLISHED,it.memberId,"work",id,now)
        })
    }
}
