package ai.storyfork.operations.activity

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.repository.AdminActivityRepository
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.event.entity.EventEntity
import ai.storyfork.operations.event.repository.EventRepository
import ai.storyfork.operations.event.service.AdminEventService
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.notice.entity.NoticeEntity
import ai.storyfork.operations.notice.repository.NoticeRepository
import ai.storyfork.operations.notice.service.AdminNoticeService
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.security.OperationsMember
import jakarta.validation.Validation
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.aop.framework.ProxyFactory
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource
import org.springframework.transaction.interceptor.TransactionInterceptor
import org.springframework.transaction.support.AbstractPlatformTransactionManager
import org.springframework.transaction.support.DefaultTransactionStatus

/**
 * begin·commit·rollback을 순서대로 남기고, 이미 열린 트랜잭션에는 합류한다(REQUIRED).
 * 실제 `@Transactional` 어드바이스 아래에서 서비스가 도는 모양을 DB 없이 재현한다.
 */
private class LoggingTransactionManager(private val log: MutableList<String>) : AbstractPlatformTransactionManager() {
    private var active = false

    override fun doGetTransaction(): Any = this
    override fun isExistingTransaction(transaction: Any) = active
    override fun doBegin(transaction: Any, definition: TransactionDefinition) { active = true; log += "begin" }
    override fun doCommit(status: DefaultTransactionStatus) { active = false; log += "commit" }
    override fun doRollback(status: DefaultTransactionStatus) { active = false; log += "rollback" }
    override fun doSetRollbackOnly(status: DefaultTransactionStatus) {}
}

/**
 * 공지·이벤트 변경과 관리자 활동 기록은 한 트랜잭션이다(계약: 운영 DB만 바꾸는 조치는 같은 트랜잭션에 기록).
 * 변경이 자기 트랜잭션에서 먼저 커밋되면 기록이 실패해도 변경은 남아 "조치는 됐는데 기록이 없는" 상태가 된다.
 */
class AdminChangeTransactionTest {
    private val log = mutableListOf<String>()
    private val manager = LoggingTransactionManager(log)

    private val notice = NoticeEntity(title = "기존 제목", body = "기존 본문")
    private val event = EventEntity(title = "기존 제목", body = "기존 본문")

    // 저장소는 호출 순서만 log에 남기는 대역이다. 매처를 쓰지 않으니 널 불가 인자에도 안전하다.
    private val noticeRepository = mock(NoticeRepository::class.java) { call ->
        when (call.method.name) {
            "findById" -> { log += "find"; Optional.of(notice) }
            "saveAndFlush" -> { log += "save"; call.arguments[0] }
            "delete" -> { log += "delete"; null }
            else -> null
        }
    }
    private val eventRepository = mock(EventRepository::class.java) { call ->
        when (call.method.name) {
            "findById" -> { log += "find"; Optional.of(event) }
            "save" -> { log += "save"; call.arguments[0] }
            "delete" -> { log += "delete"; null }
            else -> null
        }
    }
    private val permissions = mock(AdminPermissionRepository::class.java) { call ->
        if (call.method.name == "existsByMemberIdAndPermission") true else null
    }

    /** 기록 저장을 log에 남기고, [failure]가 있으면 던진다. */
    private val activities = object : AdminActivityService(
        mock(AdminActivityRepository::class.java), mock(AdminPermissionRepository::class.java), mock(CoreClient::class.java),
    ) {
        var failure: RuntimeException? = null

        override fun record(actor: OperationsMember, action: String, targetType: String, targetId: Any, detail: String?) {
            log += "record"
            failure?.let { throw it }
        }
    }

    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val validator = Validation.buildDefaultValidatorFactory().validator
    private val notices = transactional(AdminNoticeService(transactional(NoticeService(noticeRepository)), permissions, validator, activities))
    private val events = transactional(AdminEventService(transactional(EventService(eventRepository)), permissions, validator, activities))

    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> transactional(target: T): T = ProxyFactory(target).apply {
        isProxyTargetClass = true
        addAdvice(TransactionInterceptor().apply {
            transactionManager = manager
            transactionAttributeSource = AnnotationTransactionAttributeSource()
        })
    }.proxy as T

    /** 변경 한 건과, 그 변경이 기록 직전까지 남기는 저장소 호출 순서. */
    private val changes: List<Triple<String, () -> Unit, List<String>>> = listOf(
        Triple("notice create", { notices.create(admin, NoticeRequest("제목", "본문")) }, listOf("save")),
        Triple("notice update", { notices.update(admin, notice.id, NoticeRequest("새 제목", "새 본문")) }, listOf("find", "save")),
        Triple("notice delete", { notices.delete(admin, notice.id) }, listOf("find", "delete")),
        Triple("event create", { events.create(admin, EventRequest("제목", "본문")) }, listOf("save")),
        Triple("event update", { events.update(admin, event.id, EventRequest("새 제목", "새 본문")) }, listOf("find")),
        Triple("event delete", { events.delete(admin, event.id) }, listOf("find", "delete")),
    )

    @Test
    fun `a change and its activity record commit in one transaction`() {
        for ((name, change, writes) in changes) {
            log.clear()

            change()

            assertEquals(listOf("begin") + writes + listOf("record", "commit"), log, name)
        }
    }

    @Test
    fun `when the activity record fails the change is rolled back with it`() {
        activities.failure = IllegalStateException("activity store down")
        for ((name, change, writes) in changes) {
            log.clear()

            assertThrows(IllegalStateException::class.java) { change() }

            // 롤백이 변경 앞의 begin과 기록 사이를 한 번에 닫아야 한다: 변경이 먼저 커밋돼 있으면 begin·commit이 두 번 나온다.
            assertEquals(listOf("begin") + writes + listOf("record", "rollback"), log, name)
        }
    }
}
