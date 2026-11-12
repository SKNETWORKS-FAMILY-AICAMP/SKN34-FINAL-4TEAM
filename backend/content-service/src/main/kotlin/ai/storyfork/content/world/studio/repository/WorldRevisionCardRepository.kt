package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldRevisionCard
import ai.storyfork.content.world.studio.entity.RevisionCardKey
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface WorldRevisionCardRepository : JpaRepository<WorldRevisionCard, RevisionCardKey> {
    fun findAllByIdRevisionId(revisionId: UUID): List<WorldRevisionCard>

    /** 여러 저장 버전의 공개 카드(삭제되지 않았고 공개인 카드, DEC-46)를 (revisionId, cardId) 쌍으로 돌려준다. 공개 목록의 카드 수와 관계 끝점 판정에 쓴다. */
    @Query("select rc.id.revisionId, rc.id.cardId from WorldRevisionCard rc join SettingCardVersion v on v.id=rc.versionId where rc.id.revisionId in :revisions and v.fields.lifecycle='active' and v.fields.visibility='public'")
    fun publicCardIds(@Param("revisions") revisions: Collection<UUID>): List<Array<Any>>
}
