package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.work.domain.WorkViews
import ai.storyfork.content.work.domain.viewDate
import ai.storyfork.content.work.entity.WorkViewEntity
import ai.storyfork.content.work.repository.WorkViewRepository
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

private val VIEW_WINDOW: Duration = Duration.ofHours(24)

/** 공개 회차 조회 기록(work_view)과 작품별 최근 조회 수 집계를 맡는다. */
@Service
class WorkViewService(
    private val access: WorkAccessService,
    private val current: EpisodeCurrentRepository,
    private val views: WorkViewRepository,
) {

    /**
     * 공개 작품의 발행 회차 조회를 회원·회차별 하루(Asia/Seoul) 1회만 기록하고 같은 날 중복은 무시한다. 소유자 검사는 없다.
     * 저장소 호출이 각자 트랜잭션을 가져야 동시 중복 INSERT의 unique 위반을 삼켜도 다른 호출이 오염되지 않으므로 서비스 트랜잭션은 쓰지 않는다.
     */
    @Transactional(transactionManager="contentTransactionManager", propagation=Propagation.NOT_SUPPORTED)
    fun record(id: String, number: Int, member: String) {
        checkContent(member.isNotBlank() && member.length<=200,401,"서버 인증이 필요합니다.")
        access.published(id)
        checkContent(current.findByWorkIdAndSequence(id,number)?.publishedVersionId!=null,404,"공개 회차를 찾을 수 없어요.")
        val now=Instant.now().truncatedTo(ChronoUnit.MICROS)
        val key=WorkViewEntity.Key(id,number,member,viewDate(now))
        if(views.existsById(key)) return
        try {
            views.saveAndFlush(WorkViewEntity(key.workId,key.episodeNumber,key.memberId,key.viewDate,now))
        } catch(error: DataIntegrityViolationException) {
            // 같은 회원의 동시 요청이 방금 오늘 행을 저장했다면 중복이므로 무시한다.
            if(!views.existsById(key)) throw error
        }
    }

    /** 회차별 누적 회원 조회 수(회원·회차별 하루 1회 기록의 전체 합)다. 비회원 조회는 기록하지 않아 세지 않는다. */
    fun episodeCounts(id: String): Map<Int, Long> =
        views.countByEpisode(id).associate { row -> (row[0] as Number).toInt() to (row[1] as Number).toLong() }

    /** 작품별 최근 [window](기본 24시간)와 그 앞 같은 길이 구간의 조회 수다. 두 구간 모두 조회가 없는 작품은 담지 않는다. */
    fun counts(window: Duration = VIEW_WINDOW): Map<String, WorkViews> {
        val split=Instant.now().minus(window)
        return views.countByWork(split.minus(window),split).associate { row ->
            row[0] as String to WorkViews((row[1] as Number).toLong(),(row[2] as Number).toLong())
        }
    }

}
