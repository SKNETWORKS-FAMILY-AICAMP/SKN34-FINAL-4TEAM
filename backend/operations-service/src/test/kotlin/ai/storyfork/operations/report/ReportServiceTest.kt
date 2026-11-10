package ai.storyfork.operations.report

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.report.entity.ReportEntity
import ai.storyfork.operations.report.entity.ReportHistoryEntity
import ai.storyfork.operations.report.entity.ReportHistoryType
import ai.storyfork.operations.report.entity.ReportKind
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.repository.ReportHistoryRepository
import ai.storyfork.operations.report.repository.ReportRepository
import ai.storyfork.operations.report.service.ReportService
import ai.storyfork.operations.report.service.dto.ReportBodyRequest
import ai.storyfork.operations.report.service.dto.ReportRequest
import ai.storyfork.operations.report.service.dto.ReportReviewRequest
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import org.springframework.aop.framework.ProxyFactory
import org.springframework.http.HttpStatus
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource
import org.springframework.transaction.interceptor.TransactionInterceptor
import org.springframework.transaction.support.AbstractPlatformTransactionManager
import org.springframework.transaction.support.DefaultTransactionStatus
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException

/** Counts transaction boundaries without any resource, so the service runs under the real `@Transactional` advice. */
private class RecordingTransactionManager : AbstractPlatformTransactionManager() {
    var begins = 0
    var commits = 0

    override fun doGetTransaction(): Any = Any()
    override fun doBegin(transaction: Any, definition: TransactionDefinition) { begins++ }
    override fun doCommit(status: DefaultTransactionStatus) { commits++ }
    override fun doRollback(status: DefaultTransactionStatus) {}
}

/** Mocked repositories and Content client: no Spring context, HTTP or database. */
class ReportServiceTest {
    private val reports = mock(ReportRepository::class.java)
    private val histories = mock(ReportHistoryRepository::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val content = mock(ContentClient::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val txManager = RecordingTransactionManager()
    private val service = ProxyFactory(ReportService(reports, histories, permissions, content, TransactionTemplate(txManager), activities)).apply {
        isProxyTargetClass = true
        addAdvice(TransactionInterceptor().apply {
            transactionManager = txManager
            transactionAttributeSource = AnnotationTransactionAttributeSource()
        })
    }.proxy as ReportService

    private val reporter = OperationsMember(UUID.randomUUID(), false)
    private val owner = OperationsMember(UUID.randomUUID(), false)
    private val stranger = OperationsMember(UUID.randomUUID(), false)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutRights = OperationsMember(UUID.randomUUID(), true)
    private val workId = UUID.randomUUID()
    private val reportId = UUID.randomUUID()

    private fun report() = ReportEntity(
        id = reportId, kind = ReportKind.RIGHTS, workId = workId, workTitle = "작품", workOwnerId = owner.memberId,
        reporterId = reporter.memberId, reason = "도용", evidence = "", createdAt = Instant.parse("2026-01-01T00:00:00Z"),
    )

    private fun givenReport(): ReportEntity = report().also {
        `when`(reports.findById(reportId)).thenReturn(Optional.of(it))
        `when`(reports.saveAndFlush(any(ReportEntity::class.java) ?: it)).thenAnswer { call -> call.arguments[0] }
    }

    private fun givenRights() {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "rights")).thenReturn(true)
        // A non-operator must stay denied even if a stale permission row exists.
        `when`(permissions.existsByMemberIdAndPermission(reporter.memberId, "rights")).thenReturn(true)
    }

    private fun assertStatus(status: HttpStatus, call: () -> Unit) {
        assertEquals(status, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    private fun savedHistory(): ReportHistoryEntity {
        val captor = ArgumentCaptor.forClass(ReportHistoryEntity::class.java)
        verify(histories).saveAndFlush(captor.capture())
        return captor.value
    }

    @Test
    fun `create stores Content owner and title with RECEIVED status for the authenticated reporter`() {
        `when`(content.work(workId)).thenReturn(ContentWork(workId, owner.memberId.toString(), "원작 제목", false))
        `when`(reports.saveAndFlush(any(ReportEntity::class.java) ?: report())).thenAnswer { it.arguments[0] }

        val result = service.create(reporter, ReportRequest(ReportKind.HARMFUL, workId, "유해", "링크"))

        assertEquals(reporter.memberId, result.reporterId)
        assertEquals(owner.memberId, result.workOwnerId)
        assertEquals("원작 제목", result.workTitle)
        assertEquals(ReportStatus.RECEIVED, result.status)
        assertFalse(result.contentRestricted)
        assertNull(result.history)
        verifyNoInteractions(activities)
    }

    @Test
    fun `invalid report input is rejected before Content or repositories`() {
        for (request in listOf(
            ReportRequest(ReportKind.RIGHTS, workId, " ", ""), ReportRequest(ReportKind.RIGHTS, workId, "r".repeat(2001), ""),
            ReportRequest(ReportKind.RIGHTS, workId, "a\u0000", ""), ReportRequest(ReportKind.RIGHTS, workId, "ok", "e".repeat(5001)),
            ReportRequest(ReportKind.RIGHTS, workId, "ok", "\u0000"),
        )) assertThrows(IllegalArgumentException::class.java) { service.create(reporter, request) }

        verifyNoInteractions(content, reports, histories)
    }

    @Test
    fun `Content failure propagates and nothing is stored`() {
        `when`(content.work(workId)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertStatus(HttpStatus.BAD_GATEWAY) { service.create(reporter, ReportRequest(ReportKind.RIGHTS, workId, "도용", "")) }

        verifyNoInteractions(reports, histories)
    }

    @Test
    fun `create rejects a work whose owner cannot be a member with 409 before storing anything`() {
        `when`(content.work(workId)).thenReturn(ContentWork(workId, "ops-work-owner", "작품", false))

        val failure = assertThrows(ResponseStatusException::class.java) {
            service.create(reporter, ReportRequest(ReportKind.HARMFUL, workId, "유해", "링크"))
        }

        assertEquals(HttpStatus.CONFLICT, failure.statusCode)
        assertEquals("작품 소유자를 확인할 수 없어 신고할 수 없어요.", failure.reason)
        verify(content).work(workId)
        verifyNoMoreInteractions(content)
        verifyNoInteractions(reports, histories)
    }

    @Test
    fun `operations list requires operator and rights permission and applies the status filter`() {
        givenRights()
        assertStatus(HttpStatus.FORBIDDEN) { service.list(reporter, null) }
        assertStatus(HttpStatus.FORBIDDEN) { service.list(operatorWithoutRights, null) }
        `when`(reports.findTop200ByStatusOrderByCreatedAtDescIdDesc(ReportStatus.ACCEPTED)).thenReturn(listOf(report()))

        assertEquals(listOf(reportId), service.list(admin, ReportStatus.ACCEPTED).items.map { it.id })
        verify(reports, never()).findTop200ByOrderByCreatedAtDescIdDesc()
    }

    @Test
    fun `mine queries reports filed by or targeting the member`() {
        `when`(reports.findTop200ByReporterIdOrWorkOwnerIdOrderByCreatedAtDescIdDesc(owner.memberId, owner.memberId))
            .thenReturn(listOf(report()))

        assertEquals(listOf(reportId), service.mine(owner).items.map { it.id })
    }

    @Test
    fun `detail is visible to reporter owner and rights admin only and includes history`() {
        givenReport()
        givenRights()
        val history = ReportHistoryEntity(reportId = reportId, type = ReportHistoryType.EVIDENCE_REQUEST, actorId = admin.memberId, body = "증빙")
        `when`(histories.findAllByReportIdOrderByCreatedAtAscIdAsc(reportId)).thenReturn(listOf(history))

        for (viewer in listOf(reporter, owner, admin)) {
            assertEquals(listOf(ReportHistoryType.EVIDENCE_REQUEST), service.detail(viewer, reportId).history?.map { it.type })
        }
        assertStatus(HttpStatus.FORBIDDEN) { service.detail(stranger, reportId) }
        assertStatus(HttpStatus.FORBIDDEN) { service.detail(operatorWithoutRights, reportId) }
    }

    @Test
    fun `unknown report is not found`() {
        `when`(reports.findById(reportId)).thenReturn(Optional.empty())

        assertThrows(NoSuchElementException::class.java) { service.detail(reporter, reportId) }
    }

    @Test
    fun `only the reporter adds evidence and only the owner adds explanations`() {
        givenReport()
        assertStatus(HttpStatus.FORBIDDEN) { service.addEvidence(owner, reportId, ReportBodyRequest("추가")) }
        assertStatus(HttpStatus.FORBIDDEN) { service.addExplanation(reporter, reportId, ReportBodyRequest("소명")) }
        verify(histories, never()).saveAndFlush(any(ReportHistoryEntity::class.java))

        service.addExplanation(owner, reportId, ReportBodyRequest("소명"))

        val history = savedHistory()
        assertEquals(ReportHistoryType.EXPLANATION, history.type)
        assertEquals(owner.memberId, history.actorId)
        assertEquals("소명", history.body)
        service.addEvidence(reporter, reportId, ReportBodyRequest("추가"))
        // Reporter and owner actions are not admin actions.
        verifyNoInteractions(activities)
    }

    @Test
    fun `evidence body must be non blank and free of NUL`() {
        givenReport()
        for (body in listOf("", " \n", "a\u0000", "b".repeat(5001))) {
            assertThrows(IllegalArgumentException::class.java) { service.addEvidence(reporter, reportId, ReportBodyRequest(body)) }
        }
        verify(histories, never()).saveAndFlush(any(ReportHistoryEntity::class.java))
    }

    @Test
    fun `explanation list returns only explanation history to viewers`() {
        givenReport()
        `when`(histories.findAllByReportIdAndTypeOrderByCreatedAtAscIdAsc(reportId, ReportHistoryType.EXPLANATION)).thenReturn(listOf(
            ReportHistoryEntity(reportId = reportId, type = ReportHistoryType.EXPLANATION, actorId = owner.memberId, body = "소명"),
        ))

        assertEquals(listOf("소명"), service.explanations(reporter, reportId).items.map { it.body })
        assertStatus(HttpStatus.FORBIDDEN) { service.explanations(stranger, reportId) }
    }

    @Test
    fun `review requires rights and a final decision and records REVIEW`() {
        val row = givenReport()
        givenRights()
        assertStatus(HttpStatus.FORBIDDEN) { service.review(reporter, reportId, ReportReviewRequest(ReportStatus.ACCEPTED, "인정")) }
        assertThrows(IllegalArgumentException::class.java) { service.review(admin, reportId, ReportReviewRequest(ReportStatus.RECEIVED, "보류")) }
        assertThrows(IllegalArgumentException::class.java) { service.review(admin, reportId, ReportReviewRequest(ReportStatus.REJECTED, " ")) }
        assertEquals(ReportStatus.RECEIVED, row.status)

        val result = service.review(admin, reportId, ReportReviewRequest(ReportStatus.ACCEPTED, "인정"))

        assertEquals(ReportStatus.ACCEPTED, result.status)
        assertEquals(ReportHistoryType.REVIEW, savedHistory().type)
    }

    @Test
    fun `restriction calls Content then sets the flag and records RESTRICT and UNRESTRICT`() {
        givenReport()
        givenRights()
        `when`(content.restrict(workId)).thenReturn(ContentWork(workId, owner.memberId.toString(), "작품", true))

        assertTrue(service.restrict(admin, reportId).contentRestricted)
        assertEquals(ReportHistoryType.RESTRICT, savedHistory().type)

        reset(histories)
        `when`(content.unrestrict(workId)).thenReturn(ContentWork(workId, owner.memberId.toString(), "작품", false))
        assertFalse(service.unrestrict(admin, reportId).contentRestricted)
        assertEquals(ReportHistoryType.UNRESTRICT, savedHistory().type)
    }

    @Test
    fun `restriction failure in Content leaves the report and history unchanged`() {
        val row = givenReport()
        givenRights()
        `when`(content.restrict(workId)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertStatus(HttpStatus.BAD_GATEWAY) { service.restrict(admin, reportId) }

        assertFalse(row.contentRestricted)
        verifyNoInteractions(histories)
        verify(reports, never()).saveAndFlush(any(ReportEntity::class.java))
    }

    @Test
    fun `admin actions record their activity with the report id after the change is saved`() {
        givenReport()
        givenRights()
        `when`(content.restrict(workId)).thenReturn(ContentWork(workId, owner.memberId.toString(), "작품", true))
        `when`(content.unrestrict(workId)).thenReturn(ContentWork(workId, owner.memberId.toString(), "작품", false))

        service.review(admin, reportId, ReportReviewRequest(ReportStatus.REJECTED, "기각"))
        service.requestEvidence(admin, reportId, ReportBodyRequest("증빙 제출"))
        service.restrict(admin, reportId)
        service.unrestrict(admin, reportId)

        verify(activities).record(admin, "REPORT_REVIEW", "REPORT", reportId, "REJECTED")
        verify(activities).record(admin, "REPORT_REQUEST_EVIDENCE", "REPORT", reportId, null)
        verify(activities).record(admin, "REPORT_RESTRICT", "REPORT", reportId, null)
        verify(activities).record(admin, "REPORT_UNRESTRICT", "REPORT", reportId, null)
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `no activity is recorded for a denied invalid missing or failed admin action`() {
        givenReport()
        givenRights()
        val accepted = ReportReviewRequest(ReportStatus.ACCEPTED, "인정")
        for (denied in listOf(reporter, operatorWithoutRights)) {
            assertStatus(HttpStatus.FORBIDDEN) { service.review(denied, reportId, accepted) }
            assertStatus(HttpStatus.FORBIDDEN) { service.requestEvidence(denied, reportId, ReportBodyRequest("증빙")) }
            assertStatus(HttpStatus.FORBIDDEN) { service.restrict(denied, reportId) }
            assertStatus(HttpStatus.FORBIDDEN) { service.unrestrict(denied, reportId) }
        }
        assertThrows(IllegalArgumentException::class.java) { service.review(admin, reportId, ReportReviewRequest(ReportStatus.RECEIVED, "보류")) }
        assertThrows(IllegalArgumentException::class.java) { service.review(admin, reportId, ReportReviewRequest(ReportStatus.REJECTED, " ")) }
        assertThrows(IllegalArgumentException::class.java) { service.requestEvidence(admin, reportId, ReportBodyRequest(" ")) }
        `when`(content.restrict(workId)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.unrestrict(workId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        assertStatus(HttpStatus.BAD_GATEWAY) { service.restrict(admin, reportId) }
        assertStatus(HttpStatus.NOT_FOUND) { service.unrestrict(admin, reportId) }
        doThrow(IllegalStateException("db down")).`when`(histories).saveAndFlush(
            any(ReportHistoryEntity::class.java) ?: ReportHistoryEntity(reportId = reportId, type = ReportHistoryType.REVIEW, actorId = admin.memberId, body = null),
        )
        assertThrows(IllegalStateException::class.java) { service.review(admin, reportId, accepted) }
        `when`(reports.findById(reportId)).thenReturn(Optional.empty())
        assertThrows(NoSuchElementException::class.java) { service.review(admin, reportId, accepted) }
        assertThrows(NoSuchElementException::class.java) { service.requestEvidence(admin, reportId, ReportBodyRequest("증빙")) }
        assertThrows(NoSuchElementException::class.java) { service.restrict(admin, reportId) }

        verifyNoInteractions(activities)
    }

    private fun inTransaction() = TransactionSynchronizationManager.isActualTransactionActive()

    /** Logs each Content call and local save with whether it ran inside a transaction. */
    private fun recordSteps(): MutableList<String> {
        val steps = mutableListOf<String>()
        fun step(name: String) { steps += "$name:${inTransaction()}" }
        `when`(content.work(workId)).thenAnswer { step("content"); ContentWork(workId, owner.memberId.toString(), "작품", false) }
        `when`(content.restrict(workId)).thenAnswer { step("content"); ContentWork(workId, owner.memberId.toString(), "작품", true) }
        `when`(content.unrestrict(workId)).thenAnswer { step("content"); ContentWork(workId, owner.memberId.toString(), "작품", false) }
        doAnswer { step("report"); it.arguments[0] }.`when`(reports).saveAndFlush(any(ReportEntity::class.java) ?: report())
        doAnswer { step("history"); it.arguments[0] }.`when`(histories).saveAndFlush(
            any(ReportHistoryEntity::class.java) ?: ReportHistoryEntity(reportId = reportId, type = ReportHistoryType.REVIEW, actorId = admin.memberId, body = null),
        )
        return steps
    }

    /** Runs [action] and expects [expected] steps with exactly one committed transaction around the saves. */
    private fun assertOneTransaction(steps: MutableList<String>, expected: List<String>, action: () -> Unit) {
        steps.clear()
        val (begun, committed) = txManager.begins to txManager.commits

        action()

        assertEquals(expected, steps)
        assertEquals(begun + 1, txManager.begins)
        assertEquals(committed + 1, txManager.commits)
    }

    @Test
    fun `create calls Content outside any transaction`() {
        val steps = recordSteps()

        service.create(reporter, ReportRequest(ReportKind.HARMFUL, workId, "유해", "링크"))

        assertEquals("content:false", steps.first())
    }

    @Test
    fun `restriction calls Content outside a transaction then saves the report and history in one`() {
        givenReport()
        givenRights()
        val steps = recordSteps()

        for (action in listOf(service::restrict, service::unrestrict)) {
            assertOneTransaction(steps, listOf("content:false", "report:true", "history:true")) { action(admin, reportId) }
        }
    }

    @Test
    fun `changes without Content still save the report and history in one transaction`() {
        givenReport()
        givenRights()
        val steps = recordSteps()
        val saves = listOf("report:true", "history:true")

        assertOneTransaction(steps, saves) { service.addEvidence(reporter, reportId, ReportBodyRequest("추가")) }
        assertOneTransaction(steps, saves) { service.addExplanation(owner, reportId, ReportBodyRequest("소명")) }
        assertOneTransaction(steps, saves) { service.review(admin, reportId, ReportReviewRequest(ReportStatus.ACCEPTED, "인정")) }
        assertOneTransaction(steps, saves) { service.requestEvidence(admin, reportId, ReportBodyRequest("증빙")) }
    }

    /** Logs each activity record with whether it ran inside a transaction. */
    private fun recordActivitySteps(steps: MutableList<String>) {
        doAnswer { steps += "activity:${inTransaction()}"; null }.`when`(activities).record(
            any(OperationsMember::class.java) ?: admin, anyString(), anyString(), any() ?: reportId, nullable(String::class.java),
        )
    }

    @Test
    fun `the activity is saved in the same single transaction as the report and history after Content`() {
        givenReport()
        givenRights()
        val steps = recordSteps()
        recordActivitySteps(steps)

        for (action in listOf(service::restrict, service::unrestrict)) {
            assertOneTransaction(steps, listOf("content:false", "report:true", "history:true", "activity:true")) { action(admin, reportId) }
        }
        val saves = listOf("report:true", "history:true", "activity:true")
        assertOneTransaction(steps, saves) { service.review(admin, reportId, ReportReviewRequest(ReportStatus.ACCEPTED, "인정")) }
        assertOneTransaction(steps, saves) { service.requestEvidence(admin, reportId, ReportBodyRequest("증빙")) }
    }

    @Test
    fun `restriction and evidence requests are denied without rights before calling Content`() {
        givenReport()
        givenRights()
        assertStatus(HttpStatus.FORBIDDEN) { service.restrict(owner, reportId) }
        assertStatus(HttpStatus.FORBIDDEN) { service.unrestrict(operatorWithoutRights, reportId) }
        assertStatus(HttpStatus.FORBIDDEN) { service.requestEvidence(reporter, reportId, ReportBodyRequest("증빙")) }
        verifyNoInteractions(content)

        service.requestEvidence(admin, reportId, ReportBodyRequest("증빙 제출"))

        assertEquals(ReportHistoryType.EVIDENCE_REQUEST, savedHistory().type)
    }
}
