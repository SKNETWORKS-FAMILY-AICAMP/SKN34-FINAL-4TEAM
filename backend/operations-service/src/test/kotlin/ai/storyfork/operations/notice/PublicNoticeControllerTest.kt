package ai.storyfork.operations.notice

import ai.storyfork.operations.notice.controller.PublicNoticeController
import ai.storyfork.operations.notice.entity.NoticeEntity
import ai.storyfork.operations.notice.repository.NoticeRepository
import ai.storyfork.operations.notice.service.NoticeService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort

/** 실제 [NoticeService] 뒤의 저장소만 대역으로 둔 단위 테스트다. Spring·HTTP·DB가 없다. */
class PublicNoticeControllerTest {
    private val repository = mock(NoticeRepository::class.java)
    private val controller = PublicNoticeController(NoticeService(repository))

    @Test
    fun `list returns at most the latest 100 notices by creation time and UUID`() {
        val bounded = PageRequest.of(0, 100, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")))
        val entity = NoticeEntity(title = "공지", body = "본문")
        `when`(repository.findAll(bounded)).thenReturn(PageImpl(listOf(entity), bounded, 1))

        val result = controller.list()

        assertEquals(listOf(entity.id), result.items.map { it.id })
        assertEquals(0, result.page)
        assertEquals(100, result.size)
    }
}
