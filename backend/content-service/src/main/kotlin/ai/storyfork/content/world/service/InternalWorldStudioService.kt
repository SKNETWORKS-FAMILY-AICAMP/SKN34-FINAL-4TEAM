package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.dto.OperationsWorldResponse
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import ai.storyfork.content.world.studio.repository.WorldDraftRepository
import ai.storyfork.content.world.studio.repository.WorldRevisionRepository
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

private const val WORLD_RESTRICTED = "content.operator.world-restricted"
private const val WORLD_UNRESTRICTED = "content.operator.world-unrestricted"

/**
 * 운영 서비스 전용 세계관 조회와 공개 제한·해제다. 소유권 검사 없이 서비스 토큰으로만 보호된다. 제한은 공개 세계관 경로만 막고 소유자·연결된 소설 위키·Fork 이어받기는 그대로다.
 * WorldStudio 읽기·쓰기는 한 트랜잭션이고, 연결된 소설(Content 트랜잭션)은 그 밖에서 한 번에 조회해 두 트랜잭션을 겹치지 않는다.
 */
@Service
class InternalWorldStudioService(
    private val worlds: StudioWorldRepository, private val revisions: WorldRevisionRepository, private val drafts: WorldDraftRepository,
    private val links: WorkWorldService,
    private val outbox: ContentEventOutboxRepository,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager)
    private val log = LoggerFactory.getLogger(InternalWorldStudioService::class.java)

    /** 지우지 않은 전체 세계관(최신순)이다. 이름은 확정 버전·초안을 각각 쿼리 한 번으로 읽고 연결 작품도 한 번에 조회한다. */
    fun list(): List<OperationsWorldResponse> = withLinks(transaction.execute { views(worlds.listForOperations()) }!!)

    /**
     * 제한 플래그를 바꾼다(멱등). 없거나 지운 세계관은 404다.
     * 플래그가 실제로 바뀌었으면 그 커밋 뒤 세계관 소유자에게 보낼 운영자 조치 알림 사건을 outbox에 쓴다(#941). outbox는 Content DB라 WorldStudio 트랜잭션에 넣을 수 없다.
     * 제한은 이미 반영됐으므로 기록이 실패해도 요청을 실패시키지 않고 로그만 남긴다.
     * ponytail: 커밋과 기록 사이에 장애가 나면 제한은 됐는데 알림이 빠진다(McpChangeNotice와 같은 한계). 막으려면 WorldStudio 쪽 outbox가 필요하다.
     */
    fun restrict(worldId: UUID, restricted: Boolean): OperationsWorldResponse {
        var changed = false
        val view = transaction.execute {
            val world = worlds.lockLive(worldId) ?: throw ContentFailure(404, "세계관을 찾을 수 없어요.")
            changed = world.restricted != restricted
            world.restricted = restricted
            views(listOf(world))
        }!!.single()
        // 알림 기록은 연결 작품 조회(withLinks)보다 먼저 한다. 조회가 실패해 요청이 500이 되어도 제한은 이미 반영돼, 재시도는 changed=false라 알림이 영영 빠진다.
        if (changed) try {
            outbox.save(ContentEventOutboxEntity(UUID.randomUUID(), if (restricted) WORLD_RESTRICTED else WORLD_UNRESTRICTED, view.ownerId.toString(), "world",
                worldId.toString(), detailTitle = view.name.ifBlank { null }))
        } catch (e: Exception) {
            log.error("세계관 제한 알림 기록 실패(제한은 이미 반영됨): world={} cause={}", worldId, e.javaClass.name)
        }
        return withLinks(listOf(view)).single()
    }

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
