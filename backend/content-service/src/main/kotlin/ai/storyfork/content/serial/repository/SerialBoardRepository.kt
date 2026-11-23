package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialBoardEntity
import java.time.Instant
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface SerialBoardRepository : JpaRepository<SerialBoardEntity, String> {
    /** 작품의 열린(open·queued·running) 게시판이다. 부분 유니크라 많아야 하나다. */
    fun findFirstByWorkIdAndStatusIn(workId: String, statuses: Collection<String>): SerialBoardEntity?
    fun findFirstByWorkIdAndStatus(workId: String, status: String): SerialBoardEntity?

    /** 작품의 가장 최근 [status] 게시판이다(독자에게 보이는 마지막 종합 문장은 published에서 읽는다). */
    fun findFirstByWorkIdAndStatusOrderByOpenedAtDesc(workId: String, status: String): SerialBoardEntity?
    fun findAllByStatus(status: String): List<SerialBoardEntity>

    /** [before] 전에 마감(선점)한 [status] 게시판이다. 서버 재시작으로 running에 남은 행을 찾는다. */
    fun findAllByStatusAndClosedAtBefore(status: String, before: Instant): List<SerialBoardEntity>

    /** 소유자 기록: 작품의 게시판을 최신순으로 최대 50개다. */
    fun findTop50ByWorkIdOrderByOpenedAtDescIdDesc(workId: String): List<SerialBoardEntity>

    /**
     * 실행 선점이다: [from] 상태인 게시판만 running으로 바꾸고 마감 시각을 적는다. 바뀐 행 수(0 또는 1)를 돌려주며 1을 받은 쪽만 그 게시판을 실행한다.
     * 이후 같은 트랜잭션에서 엔티티를 읽을 때 낡은 값이 없도록 영속성 컨텍스트를 비운다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update SerialBoardEntity b set b.status = 'running', b.closedAt = :now where b.id = :id and b.status = :from")
    fun claim(@Param("id") id: String, @Param("from") from: String, @Param("now") now: Instant): Int
}
