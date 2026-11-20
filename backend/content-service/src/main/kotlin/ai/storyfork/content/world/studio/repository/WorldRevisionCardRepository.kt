package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldRevisionCard
import ai.storyfork.content.world.studio.entity.RevisionCardKey
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface WorldRevisionCardRepository : JpaRepository<WorldRevisionCard, RevisionCardKey> {
    fun findAllByIdRevisionId(revisionId: UUID): List<WorldRevisionCard>

    /** 여러 저장 버전의 카드 버전을 (revisionId, 카드 버전) 쌍으로 돌려준다. 공개 목록의 카드 수와 관계 끝점은 호출자가 [ai.storyfork.content.world.domain.shownCardEpisode]로 걸러 센다(DEC-53). */
    @Query("select rc.id.revisionId, v from WorldRevisionCard rc join SettingCardVersion v on v.id=rc.versionId where rc.id.revisionId in :revisions")
    fun cardVersionsOf(@Param("revisions") revisions: Collection<UUID>): List<Array<Any>>
}
