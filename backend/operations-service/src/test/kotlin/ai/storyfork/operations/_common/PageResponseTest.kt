package ai.storyfork.operations._common

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations._common.service.dto.toResponse
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import tools.jackson.databind.json.JsonMapper

/** Spring Page 없이도 읽히는 목록 응답 하나를 네 목록이 공유한다. */
class PageResponseTest {
    @Test
    fun `a Spring page becomes the explicit items and page metadata DTO`() {
        val page = PageImpl(listOf("a", "b"), PageRequest.of(1, 2), 5)

        assertEquals(PageResponse(listOf("A", "B"), 1, 2, 5, 3), page.toResponse { it.uppercase() })
    }

    @Test
    fun `the JSON keeps the field names and order of the four former list DTOs`() {
        val mapper = JsonMapper.builder().findAndAddModules().build()

        assertEquals("""{"items":[],"page":0,"size":20,"totalElements":21,"totalPages":2}""",
            mapper.writeValueAsString(PageResponse<String>(emptyList(), 0, 20, 21, 2)))
    }
}
