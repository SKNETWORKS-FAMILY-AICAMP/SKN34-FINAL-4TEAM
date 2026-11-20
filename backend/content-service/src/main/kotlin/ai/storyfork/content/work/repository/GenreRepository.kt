package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.GenreEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.*

interface GenreRepository : JpaRepository<GenreEntity, String> {
    /** 지금 고를 수 있는(활성) 장르를 표시 순서대로 돌려준다. */
    @Query("select g from GenreEntity g where g.active = true order by g.position, g.code")
    fun findActive(): List<GenreEntity>

    /** 운영 쓰기가 모든 장르를 잠그고 읽는다. 홈 노출 한도·이름 중복·순서 검사를 한 번에 하나씩 직렬화한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from GenreEntity g order by g.position, g.code")
    fun lockAll(): List<GenreEntity>

    /** [code]가 활성 장르인지다. 세계관 장르를 새로 고를 때 쓴다. */
    fun existsByCodeAndActiveTrue(code: String): Boolean
}
