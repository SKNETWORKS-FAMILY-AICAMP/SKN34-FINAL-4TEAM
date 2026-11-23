package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkWorldReferenceEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface ForkWorldReferenceRepository : JpaRepository<ForkWorldReferenceEntity, String> {
    /**
     * Fork [id]의 세계관 참조 행을 '잠가서' 읽는다(PESSIMISTIC_WRITE, Fork 세계관 독립 #583). 같은 Fork를 동시에 독립하려는 요청은 이 행에서 차례로 선다. 없으면 null이다.
     * Content 트랜잭션 안에서만 부른다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from ForkWorldReferenceEntity r where r.forkWorkId = :id")
    fun lockById(@Param("id") id: String): ForkWorldReferenceEntity?
}
