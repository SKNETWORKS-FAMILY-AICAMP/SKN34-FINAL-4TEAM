package ai.storyfork.content.preprocessing.repository

import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface PreprocessingJobRepository : JpaRepository<PreprocessingJobEntity, String> {
    /** 작품의 가장 최근에 접수한 작업이다. 접수·소유자 화면·재실행 가능 여부가 모두 이 한 건을 기준으로 한다. */
    fun findFirstByWorkIdOrderByCreatedAtDesc(workId: String): PreprocessingJobEntity?

    fun findAllByStatus(status: String, pageable: Pageable): Page<PreprocessingJobEntity>

    /** 진행 보고와 재실행이 같은 작업을 동시에 바꾸지 않게 행을 잠가 읽는다. 트랜잭션 안에서만 부른다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from PreprocessingJobEntity j where j.id = :id")
    fun lock(@Param("id") id: String): PreprocessingJobEntity?
}
