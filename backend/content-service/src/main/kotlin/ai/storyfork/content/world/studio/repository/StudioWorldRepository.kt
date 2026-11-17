package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.StudioWorld
import java.util.UUID
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface StudioWorldRepository : JpaRepository<StudioWorld, UUID> {
    /** 소유자의 지우지 않은 세계관이다. */
    fun findAllByOwnerSubjectAndDeletedAtIsNullOrderByCreatedAtDesc(ownerSubject:UUID):List<StudioWorld>
    /** 지운 세계관은 소유자에게도 없는 것이라 비소유자와 같이 null이다. 소유자 API가 모두 이 잠금 조회를 거친다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from StudioWorld w where w.id=:world and w.ownerSubject=:subject and w.deletedAt is null")
    fun lockOwned(@Param("world") world: UUID, @Param("subject") subject: UUID): StudioWorld?

    /** 공개이고 저장 버전이 있는 세계관을 최근 공개순으로 돌려준다. 초안만 있는 세계관은 공개로 설정돼도 나오지 않고 지운 세계관도 나오지 않는다. */
    @Query("select w from StudioWorld w where w.visibility='public' and w.currentRevisionId is not null and w.deletedAt is null order by w.publishedAt desc, w.id")
    fun listed(pageable: Pageable): Page<StudioWorld>

    /** [listed]에서 장르 하나만 돌려준다. */
    @Query("select w from StudioWorld w where w.visibility='public' and w.currentRevisionId is not null and w.deletedAt is null and w.genre=:genre order by w.publishedAt desc, w.id")
    fun listedByGenre(@Param("genre") genre: String, pageable: Pageable): Page<StudioWorld>
}
