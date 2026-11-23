package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.dto.OperationsWorldResponse
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import ai.storyfork.content.world.studio.repository.WorldDraftRepository
import ai.storyfork.content.world.studio.repository.WorldRevisionRepository
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 운영 서비스 전용 세계관 조회와 공개 제한·해제다. 소유권 검사 없이 서비스 토큰으로만 보호된다. 제한은 공개 세계관 경로만 막고 소유자·연결된 소설 위키·Fork 이어받기는 그대로다.
 * WorldStudio 읽기·쓰기는 한 트랜잭션이고, 연결된 소설(Content 트랜잭션)은 그 밖에서 한 번에 조회해 두 트랜잭션을 겹치지 않는다.
 */
@Service
class InternalWorldStudioService(
    private val worlds: StudioWorldRepository, private val revisions: WorldRevisionRepository, private val drafts: WorldDraftRepository,
    private val links: WorkWorldService,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager)

    /** 지우지 않은 전체 세계관(최신순)이다. 이름은 확정 버전·초안을 각각 쿼리 한 번으로 읽고 연결 작품도 한 번에 조회한다. */
    fun list(): List<OperationsWorldResponse> = withLinks(transaction.execute { views(worlds.listForOperations()) }!!)

    /** 제한 플래그를 바꾼다(멱등). 없거나 지운 세계관은 404다. */
    fun restrict(worldId: UUID, restricted: Boolean): OperationsWorldResponse = withLinks(transaction.execute {
        val world = worlds.lockLive(worldId) ?: throw ContentFailure(404, "세계관을 찾을 수 없어요.")
        world.restricted = restricted
        views(listOf(world))
    }!!).single()

    private fun views(rows: List<StudioWorld>): List<OperationsWorldResponse> {
        val saved = revisions.findAllById(rows.mapNotNull { it.currentRevisionId }).associate { it.id to it.name }
        val draft = drafts.findAllById(rows.map { it.id }).associate { it.worldId to it.name }
        return rows.map { OperationsWorldResponse(it.id, it.ownerSubject, saved[it.currentRevisionId] ?: draft[it.id].orEmpty(), it.visibility,
            it.currentRevisionId != null, it.restricted, it.genre, null, it.createdAt) }
    }

    private fun withLinks(rows: List<OperationsWorldResponse>): List<OperationsWorldResponse> {
        val linked = links.linkedWorkIds(rows.map { it.worldId })
        return rows.map { it.copy(linkedWorkId = linked[it.worldId]) }
    }
}
