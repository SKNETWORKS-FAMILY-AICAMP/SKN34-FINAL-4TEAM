package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.repository.AdminActivityRepository
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.service.ScheduleService
import ai.storyfork.operations.jobs.service.dto.ScheduleRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
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

/** begin·commit·rollback을 순서대로 남기고, 이미 열린 트랜잭션에는 합류한다(REQUIRED). */
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
 * 일정 변경·취소·재실행 요청은 운영 DB만 바꾸므로 관리자 활동 기록과 한 트랜잭션이다(활동 기록 계약).
 * 변경이 먼저 커밋되면 기록이 실패해도 변경은 남아 "조치는 됐는데 기록이 없는" 상태가 된다.
 */
class JobTransactionTest {
    private val log = mutableListOf<String>()
    private val schedules = FakeSchedules(log)
    private val runs = FakeRuns(log)
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
    private val schedule = ScheduledJobEntity(kind = "alpha", cron = "0 0 3 * * *").also { schedules.rows += it }
    private val failed = JobRunEntity(scheduleId = schedule.id, kind = "alpha", trigger = JobTrigger.SCHEDULE, status = JobStatus.FAILED, createdAt = Instant.EPOCH)
        .also { runs.rows += it }
    private val service = transactional(ScheduleService(schedules.repository, runs.repository, listOf(FakeJobHandler("alpha")), permissions, activities))

    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> transactional(target: T): T = ProxyFactory(target).apply {
        isProxyTargetClass = true
        addAdvice(TransactionInterceptor().apply {
            transactionManager = LoggingTransactionManager(log)
            transactionAttributeSource = AnnotationTransactionAttributeSource()
        })
    }.proxy as T

    /** 변경 한 건과, 그 변경이 기록 직전까지 남기는 쓰기 호출 순서. */
    private val changes: List<Triple<String, () -> Unit, List<String>>> = listOf(
        Triple("create", { service.create(admin, ScheduleRequest("alpha", "0 0 3 * * *")) }, listOf("saveAndFlush")),
        Triple("update", { service.update(admin, schedule.id, ScheduleRequest("alpha", "0 5 3 * * *")) }, listOf("saveAndFlush")),
        Triple("cancel", { service.cancel(admin, schedule.id) }, listOf("saveAndFlush")),
        Triple("requeue", { service.requeue(admin, failed) }, listOf("save")),
    )

    @Test
    fun `a schedule change and its activity record commit in one transaction`() {
        for ((name, change, writes) in changes) {
            log.clear()
            runs.rows.removeAll { it.id != failed.id }

            change()

            assertEquals(listOf("begin") + writes + listOf("record", "commit"), log, name)
        }
    }

    @Test
    fun `when the activity record fails the change is rolled back with it`() {
        activities.failure = IllegalStateException("activity store down")
        for ((name, change, writes) in changes) {
            log.clear()
            runs.rows.removeAll { it.id != failed.id }

            assertThrows(IllegalStateException::class.java) { change() }

            assertEquals(listOf("begin") + writes + listOf("record", "rollback"), log, name)
        }
    }
}
