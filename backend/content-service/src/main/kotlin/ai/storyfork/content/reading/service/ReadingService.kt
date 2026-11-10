package ai.storyfork.content.reading.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.reading.entity.ReadingEpisodeEntity
import ai.storyfork.content.reading.entity.ReadingRecordEntity
import ai.storyfork.content.reading.repository.ReadingEpisodeRepository
import ai.storyfork.content.reading.repository.ReadingRecordRepository
import ai.storyfork.content.reading.service.dto.ReadingListResponse
import ai.storyfork.content.reading.service.dto.ReadingRecordResponse
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

/** 회원의 독서 기록(이어 읽기 위치 `reading_record`와 연 회차 `reading_episode`)을 맡는다. 본인 것만 읽고 쓴다. */
@Service
class ReadingService(
    private val access: WorkAccessService,
    private val current: EpisodeCurrentRepository,
    private val records: ReadingRecordRepository,
    private val episodes: ReadingEpisodeRepository,
) {

    /**
     * 공개 작품의 발행 회차(Fork가 물려받은 회차 포함)를 열었다고 기록한다. 이어 읽기 위치는 최댓값이 아니라 방금 연 회차로 옮기고,
     * 연 회차 목록에는 한 번만 더한다. 같은 회원의 동시 요청이 겹쳐도 되도록 서비스 트랜잭션을 쓰지 않고 저장소 호출마다 독립 트랜잭션으로 실행한다.
     */
    @Transactional(transactionManager="contentTransactionManager", propagation=Propagation.NOT_SUPPORTED)
    fun record(id: String, number: Int, member: String) {
        authenticated(member)
        access.published(id)
        checkContent(current.findByWorkIdAndSequence(id,number)?.publishedVersionId!=null,404,"공개 회차를 찾을 수 없어요.")
        val now=Instant.now().truncatedTo(ChronoUnit.MICROS)
        val position=ReadingRecordEntity(member,id,number,now)
        try {
            records.saveAndFlush(position)
        } catch(error: DataIntegrityViolationException) {
            // 같은 회원의 동시 요청이 첫 행을 방금 저장했다면 이번에는 그 행을 갱신한다. 또 실패하면 그대로 알린다.
            records.saveAndFlush(position)
        }
        val key=ReadingEpisodeEntity.Key(member,id,number)
        if(episodes.existsById(key)) return
        try {
            episodes.saveAndFlush(ReadingEpisodeEntity(member,id,number,now))
        } catch(error: DataIntegrityViolationException) {
            // 같은 회차의 동시 요청이 방금 행을 저장했다면 중복이므로 무시한다.
            if(!episodes.existsById(key)) throw error
        }
    }

    /**
     * 본인의 독서 기록을 가장 최근에 읽은 작품부터 돌려준다. 지금 공개가 아닌(비공개·운영 제한) 작품은 뺀다.
     * ponytail: 기록마다 작품 접근을 조회하는 시연 규모 구현이다. 기록이 수백 건이 되면 공개 작품 id를 한 번에 거르는 쿼리로 바꾼다.
     */
    @Transactional(transactionManager="contentTransactionManager", readOnly=true)
    fun list(member: String): ReadingListResponse {
        authenticated(member)
        val read=episodes.findAllByMemberId(member).groupBy({it.workId},{it.episodeNumber})
        return ReadingListResponse(records.findAllByMemberIdOrderByUpdatedAtDescWorkIdAsc(member)
            .filter {access.get(it.workId).publiclyVisible()}
            .map {ReadingRecordResponse(it.workId,it.lastEpisode,read[it.workId].orEmpty().sorted(),it.updatedAt.toString())})
    }

    /** 본인의 한 작품 독서 기록(위치·연 회차)을 모두 지운다. 기록이 없거나 작품이 지금 비공개여도 같은 결과다(멱등). */
    @Transactional(transactionManager="contentTransactionManager")
    fun delete(id: String, member: String) {
        authenticated(member)
        records.deleteAllByMemberIdAndWorkId(member,id)
        episodes.deleteAllByMemberIdAndWorkId(member,id)
    }

    private fun authenticated(member: String) = checkContent(member.isNotBlank() && member.length<=200,401,"서버 인증이 필요합니다.")

}
