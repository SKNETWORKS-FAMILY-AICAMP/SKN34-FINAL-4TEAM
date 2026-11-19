package ai.storyfork.operations.alert

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.repository.AdminActivityRepository
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.alert.service.AlertService
import ai.storyfork.operations.alert.service.dto.AlertActRequest
import ai.storyfork.operations.alert.service.dto.AlertRuleRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
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

/** begin·commit·rollback을 순서대로 남기고, 이미 열린 트랜잭션에는 합류한다(REQUIRED). DB 없이 @Transactional 어드바이스를 재현한다. */
private class LoggingTransactionManager(private val log: MutableList<String>) : AbstractPlatformTransactionManager() {
    private var active = false

    override fun doGetTransaction(): Any = this
    override fun isExistingTransaction(transaction: Any) = active
    override fun doBegin(transaction: Any, definition: TransactionDefinition) { active = true; log += "begin" }
    override fun doCommit(status: DefaultTransactionStatus) { active = false; log += "commit" }
    override fun doRollback(status: DefaultTransactionStatus) { active = false; log += "rollback" }
    override fun doSetRollbackOnly(status: DefaultTransactionStatus) {}
}

/** 경고 처리·기준 변경은 운영 DB만 바꾸는 조치라 변경과 활동 기록이 한 트랜잭션이다(기록이 실패하면 변경도 롤백). */
class AlertChangeTransactionTest {
    private val log = mutableListOf<String>()
    private val manager = LoggingTransactionManager(log)
    private val alert = OperationAlertEntity(ruleKey = "ai_failure_rate", message = "메시지")
    private val rule = AlertRuleEntity(ruleKey = "ai_failure_rate", metric = "failure_rate", windowMinutes = 60)

    private val alerts = mock(OperationAlertRepository::class.java) { call ->
        when (call.method.name) {
            "findById" -> { log += "find"; Optional.of(alert) }
            "saveAndFlush" -> { log += "save"; call.arguments[0] }
            else -> null
        }
    }
    private val rules = mock(AlertRuleRepository::class.java) { call ->
        when (call.method.name) {
            "findById" -> { log += "find"; Optional.of(rule) }
            "saveAndFlush" -> { log += "save"; call.arguments[0] }
            else -> null
        }
    }
    private val permissions = mock(AdminPermissionRepository::class.java) { call ->
        if (call.method.name == "existsByMemberIdAndPermission") true else null
    }

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
    private val service = transactional(AlertService(alerts, rules, permissions, activities))

    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> transactional(target: T): T = ProxyFactory(target).apply {
        isProxyTargetClass = true
        addAdvice(TransactionInterceptor().apply {
            transactionManager = manager
            transactionAttributeSource = AnnotationTransactionAttributeSource()
        })
    }.proxy as T

    private val changes: List<Pair<String, () -> Unit>> = listOf(
        "alert action" to { service.act(admin, alert.id, AlertActRequest("resolved")); Unit },
        "rule update" to { service.updateRule(admin, "ai_failure_rate", AlertRuleRequest(0.2, 60, true)); Unit },
    )

    @Test
    fun `a change and its activity record commit in one transaction`() {
        for ((name, change) in changes) {
            log.clear()

            change()

            assertEquals(listOf("begin", "find", "save", "record", "commit"), log, name)
        }
    }

    @Test
    fun `when the activity record fails the change is rolled back with it`() {
        activities.failure = IllegalStateException("activity store down")
        for ((name, change) in changes) {
            log.clear()
            alert.status = "open"

            assertThrows(IllegalStateException::class.java) { change() }

            assertEquals(listOf("begin", "find", "save", "record", "rollback"), log, name)
        }
    }
}
