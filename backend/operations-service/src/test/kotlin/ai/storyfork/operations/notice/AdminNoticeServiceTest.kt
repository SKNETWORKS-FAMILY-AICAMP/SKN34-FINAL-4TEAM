package ai.storyfork.operations.notice

import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.notice.entity.NoticeEntity
import ai.storyfork.operations.notice.repository.NoticeRepository
import ai.storyfork.operations.notice.service.AdminNoticeService
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** 실제 [NoticeService] 뒤의 저장소만 대역으로 둔 단위 테스트다. Spring·HTTP·DB가 없다. */
class AdminNoticeServiceTest {
    private val notices = mock(NoticeRepository::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val service = AdminNoticeService(NoticeService(notices), permissions)

    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutNotices = OperationsMember(UUID.randomUUID(), true)
    private val plainMember = OperationsMember(UUID.randomUUID(), false)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val entity = NoticeEntity(title = "기존 제목", body = "기존 본문", createdAt = Instant.parse("2026-01-01T00:00:00Z"))

    init {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "notices")).thenReturn(true)
        // operator가 아니면 남아 있는 권한 행이 있어도 거절해야 한다.
        `when`(permissions.existsByMemberIdAndPermission(staleGrant.memberId, "notices")).thenReturn(true)
    }

    @Test
    fun `without operator and notices permission every operation is 403 before the notice repository`() {
        // 잘못된 입력도 검증보다 권한 검사가 먼저라 400이 아니라 403이다.
        val invalid = NoticeRequest(" ", "본문")
        for (denied in listOf(operatorWithoutNotices, plainMember, staleGrant)) {
            val actions = listOf<() -> Unit>(
                { service.list(denied) },
                { service.read(denied, entity.id) },
                { service.create(denied, invalid) },
                { service.update(denied, entity.id, invalid) },
                { service.delete(denied, entity.id) },
            )
            actions.forEach { action ->
                assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { action() }.statusCode)
            }
        }

        verifyNoInteractions(notices)
    }

    @Test
    fun `a notices admin lists at most the latest 100 by creation time and UUID`() {
        val bounded = PageRequest.of(0, 100, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")))
        `when`(notices.findAll(bounded)).thenReturn(PageImpl(listOf(entity), bounded, 1))

        val result = service.list(admin)

        assertEquals(listOf(entity.id), result.items.map { it.id })
        assertEquals(0, result.page)
        assertEquals(100, result.size)
        verify(notices).findAll(bounded)
    }

    @Test
    fun `a notices admin creates reads updates and deletes through NoticeService`() {
        doAnswer { it.getArgument<NoticeEntity>(0) }.`when`(notices).saveAndFlush(any())
        `when`(notices.findById(entity.id)).thenReturn(Optional.of(entity))

        assertEquals("제목", service.create(admin, NoticeRequest("제목", "본문")).title)
        assertEquals(entity.id, service.read(admin, entity.id).id)
        assertEquals("새 본문", service.update(admin, entity.id, NoticeRequest("새 제목", "새 본문")).body)
        service.delete(admin, entity.id)

        verify(notices).delete(entity)
    }
}
