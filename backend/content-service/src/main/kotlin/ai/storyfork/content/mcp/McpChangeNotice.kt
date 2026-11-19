package ai.storyfork.content.mcp

import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.work.service.WorkAccessService
import io.modelcontextprotocol.common.McpTransportContext
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

private const val WORK_CHANGED = "content.mcp.work-changed"

/**
 * MCP 쓰기 도구가 **성공한 뒤** 알림 사건(`content.mcp.world-changed`·`content.mcp.work-changed`)을 `content_event_outbox`에 한 행 남긴다.
 * 수신자는 도구를 부른 회원이다. 이 도구들은 소유자만 성공하므로 곧 그 대상의 주인이며, 운영자도 성공하는 소식 도구(`work_notice_*`)만
 * [workToOwner]로 작품 소유자에게 보낸다(남이 바꾼 것을 주인에게 알린다). 발행은 기존 `ContentEventOutboxPublisher`가 한다. 계약: docs/design/mcp-change-notice-contract.md
 * 저장소 호출이 Content 트랜잭션 매니저의 자체 짧은 트랜잭션이라 도구 안 Service(WorldStudio 포함)의 트랜잭션과 겹치지 않는다.
 * 도구는 이미 성공했으므로 수신자 조회나 저장이 실패해도 도구를 실패시키지 않고 로그만 남긴다.
 * ponytail: 업무 변경과 별도 트랜잭션이라 그 사이 장애가 나면 변경은 됐는데 알림이 빠질 수 있다. 업그레이드는 각 Service 트랜잭션 안에서 Outbox를 쓰는 것이다.
 */
@Component
class McpChangeNotice(private val outbox: ContentEventOutboxRepository, private val access: WorkAccessService) {
    private val log = LoggerFactory.getLogger(McpChangeNotice::class.java)

    /** 세계관(WorldStudio) 변경이다. [id]는 세계관 id(생성 도구는 새 세계관 id)다. */
    fun world(context: McpTransportContext, id: String) = record("content.mcp.world-changed", "world", id) { context.requireCaller().memberId }

    /** 작품 변경이다. 회차·플롯·소식·작품에 딸린 설정도 작품 단위이며 [id]는 작품 id(생성 도구는 새 작품 id)다. */
    fun work(context: McpTransportContext, id: String) = record(WORK_CHANGED, "work", id) { context.requireCaller().memberId }

    /** 운영자도 성공하는 도구(작품 소식)의 작품 변경이다. 수신자는 호출자가 아니라 [id] 작품의 소유자이며, 소유자 조회도 [record]의 보호 안에서 한다. */
    fun workToOwner(id: String) = record(WORK_CHANGED, "work", id) { access.get(id).ownerId }

    private fun record(type: String, targetType: String, targetId: String, recipient: () -> String) {
        try {
            outbox.save(ContentEventOutboxEntity(UUID.randomUUID(), type, recipient(), targetType, targetId))
        } catch (e: Exception) {
            // 예외 메시지에는 입력이 섞일 수 있어 종류만 남긴다.
            log.error("MCP 변경 알림 기록 실패(변경은 이미 반영됨): type={} target={}:{} cause={}", type, targetType, targetId, e.javaClass.name)
        }
    }
}
