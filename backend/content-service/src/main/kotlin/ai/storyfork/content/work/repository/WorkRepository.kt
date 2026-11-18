package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface WorkRepository : JpaRepository<WorkEntity, String> {
    @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from WorkEntity w where w.id in :ids order by w.id")
    fun lockAll(@Param("ids") ids: Collection<String>): List<WorkEntity>
    fun findAllByOwnerIdOrderByCreatedAtDesc(ownerId: String): List<WorkEntity>

    /** [worldStudioIds]의 WorldStudio 세계관에 연결된 작품이다(1:1이라 세계관마다 많아야 하나, DEC-46). 빈 목록으로 부르지 않는다. */
    fun findAllByWorldStudioIdIn(worldStudioIds: Collection<java.util.UUID>): List<WorkEntity>

    /**
     * [ids] 가운데 **공개 작품**(최신 공개 범위가 public이고 제한·삭제되지 않음, [ai.storyfork.content.work.service.dto.WorkAccessResult.publiclyVisible]과 같은 판정)의
     * `[작품 id, 발행된 마지막 회차 번호]` 행이다(발행한 회차가 없으면 0, 공개 작품이 아니면 행이 없다). 공개 세계관 목록의 기준 회차(DEC-53)를 페이지 전체에 쿼리 한 번으로 센다.
     * 발행 회차는 `episode_current`에서 발행 버전이 있는 행([ai.storyfork.content.publication.service.PublicationService.publishedEpisodes]와 같은 기준)의 가장 큰 번호이며 본문은 읽지 않는다. 빈 목록으로 부르지 않는다.
     */
    @Query("""select w.id, coalesce(max(c.sequence), 0)
        from WorkEntity w
        join WorkPublicationHistoryEntity p on p.workId = w.id
        left join EpisodeCurrentEntity c on c.workId = w.id and c.publishedVersionId is not null
        where w.id in :ids and w.deletedAt is null and w.restricted = false and p.visibility = 'public'
            and p.revisionNo = (select max(q.revisionNo) from WorkPublicationHistoryEntity q where q.workId = w.id)
        group by w.id""")
    fun lastPublishedOfPublicWorks(@Param("ids") ids: Collection<String>): List<Array<Any>>

    /** 운영 작품 목록용 `[작품, 권리 진술 확인 여부, 최신 공개 범위(발행 이력이 없으면 null)]` 행을 제목·id순으로 쿼리 한 번에 읽는다. */
    @Query("""select w,
        case when exists(select r.id from WorkRightsDeclarationEntity r where r.workId = w.id) then true else false end,
        (select p.visibility from WorkPublicationHistoryEntity p where p.workId = w.id
            and p.revisionNo = (select max(q.revisionNo) from WorkPublicationHistoryEntity q where q.workId = w.id))
        from WorkEntity w order by w.title, w.id""")
    fun listForOperations(): List<Array<Any?>>
}
