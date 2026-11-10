package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface WorkRepository : JpaRepository<WorkEntity, String> {
    @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from WorkEntity w where w.id in :ids order by w.id")
    fun lockAll(@Param("ids") ids: Collection<String>): List<WorkEntity>
    fun findAllByOwnerIdOrderByCreatedAtDesc(ownerId: String): List<WorkEntity>

    /** 운영 작품 목록용 `[작품, 권리 진술 확인 여부, 최신 공개 범위(발행 이력이 없으면 null)]` 행을 제목·id순으로 쿼리 한 번에 읽는다. */
    @Query("""select w,
        case when exists(select r.id from WorkRightsDeclarationEntity r where r.workId = w.id) then true else false end,
        (select p.visibility from WorkPublicationHistoryEntity p where p.workId = w.id
            and p.revisionNo = (select max(q.revisionNo) from WorkPublicationHistoryEntity q where q.workId = w.id))
        from WorkEntity w order by w.title, w.id""")
    fun listForOperations(): List<Array<Any?>>
}
