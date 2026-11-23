package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.CardCategory
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface CardCategoryRepository : JpaRepository<CardCategory, String> {
    /** 운영 쓰기가 모든 카테고리를 잠그고 읽는다. 이름 중복·번호 부여·순서 검사를 한 번에 하나씩 직렬화한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CardCategory c order by c.position, c.code")
    fun lockAll(): List<CardCategory>
}
