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
    fun findAllByOwnerSubjectOrderByCreatedAtDesc(ownerSubject:UUID):List<StudioWorld>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from StudioWorld w where w.id=:world and w.ownerSubject=:subject")
    fun lockOwned(@Param("world") world: UUID, @Param("subject") subject: UUID): StudioWorld?

    /** 공개이고 저장 버전이 있는 세계관을 최근 공개순으로 돌려준다. 초안만 있는 세계관은 공개로 설정돼도 나오지 않는다. */
    @Query("select w from StudioWorld w where w.visibility='public' and w.currentRevisionId is not null order by w.publishedAt desc, w.id")
    fun listed(pageable: Pageable): Page<StudioWorld>

    /** [listed]에서 장르 하나만 돌려준다. */
    @Query("select w from StudioWorld w where w.visibility='public' and w.currentRevisionId is not null and w.genre=:genre order by w.publishedAt desc, w.id")
    fun listedByGenre(@Param("genre") genre: String, pageable: Pageable): Page<StudioWorld>
}
