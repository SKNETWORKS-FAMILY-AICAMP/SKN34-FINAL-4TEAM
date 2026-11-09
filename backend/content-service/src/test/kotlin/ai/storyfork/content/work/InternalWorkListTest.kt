package ai.storyfork.content.work

import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.InternalWorkService
import ai.storyfork.content.work.service.dto.OperationsWorkListResponse
import ai.storyfork.content.work.service.dto.OperationsWorkResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** 운영 작품 목록 매핑을 저장소 mock으로 검증한다. 실제 SQL·HTTP는 InternalWorkListPostgresTest가 CI에서 확인한다. */
class InternalWorkListTest {
    private val works = mock(WorkRepository::class.java)

    @Test fun `list maps every row in repository order with one query and defaults a missing publication to private`() {
        val original = WorkEntity(id = "w1", ownerId = "o1", title = "가", originKind = "original", creationType = "original", authorName = "작가1")
        val fork = WorkEntity(id = "w2", ownerId = "o2", title = "나", originKind = "fork", creationType = "external_derivative", restricted = true, authorName = "작가2")
        `when`(works.listForOperations()).thenReturn(listOf(arrayOf<Any?>(original, true, "public"), arrayOf<Any?>(fork, false, null)))

        assertEquals(
            OperationsWorkListResponse(listOf(
                OperationsWorkResponse("w1", "o1", "가", "작가1", "original", "original", true, "public", false),
                OperationsWorkResponse("w2", "o2", "나", "작가2", "fork", "external_derivative", false, "private", true),
            )),
            InternalWorkService(works).list(),
        )
        verify(works).listForOperations()
        verifyNoMoreInteractions(works)
    }

    @Test fun `no works is an empty items list`() {
        `when`(works.listForOperations()).thenReturn(emptyList())

        assertEquals(OperationsWorkListResponse(emptyList()), InternalWorkService(works).list())
    }
}
