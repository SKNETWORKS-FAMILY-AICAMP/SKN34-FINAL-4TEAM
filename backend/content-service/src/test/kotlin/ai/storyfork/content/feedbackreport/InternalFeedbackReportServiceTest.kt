package ai.storyfork.content.feedbackreport

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.feedbackreport.entity.FeedbackReportEntity
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.feedbackreport.service.InternalFeedbackReportService
import ai.storyfork.content.feedbackreport.service.dto.OperationsFeedbackReportPageResponse
import ai.storyfork.content.feedbackreport.service.dto.OperationsFeedbackReportResponse
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import tools.jackson.databind.json.JsonMapper

/**
 * 운영 서비스 전용 제보 열람(#750) 조립을 저장소·Core 닉네임 mock으로 검증한다. 상태 필터·삭제 작품 제외·정렬은 저장소 JPQL이 맡으므로
 * 실제 SQL·HTTP·서비스 토큰은 InternalFeedbackReportIntegrationTest가 CI에서 확인한다.
 */
class InternalFeedbackReportServiceTest {
    private val reports = mock(FeedbackReportRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = InternalFeedbackReportService(reports, nicknames)
    private val t0 = Instant.parse("2026-11-20T01:02:03Z")

    private fun report(id: String, reporter: String = "r1", status: String = "unchecked", quote: String? = null, withdrawnAt: Instant? = null, at: Instant = t0) =
        FeedbackReportEntity(id = id, workId = "w-" + id, episodeNumber = 2, publishedVersionId = "v1", reporterId = reporter, kind = "typo", body = "본문-" + id,
            quote = quote, visibility = "private", status = status, withdrawnAt = withdrawnAt, createdAt = at, updatedAt = at)
    /** 저장소가 돌려주는 [제보, 작품 제목] 행이다. */
    private fun row(report: FeedbackReportEntity, title: String = "작품-" + report.id) = arrayOf<Any?>(report, title)
    private fun coreNames(vararg names: Pair<String, String>) {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenReturn(mapOf(*names))
    }
    private fun rejected(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `the newest page of every state is mapped with work title and the Core nickname and carries the page numbers`() {
        val request = PageRequest.of(0, 20)
        val first = report("a", reporter = "r1", quote = "인용 문장")
        val second = report("b", reporter = "r2", status = "answered", withdrawnAt = t0.plusSeconds(5), at = t0.plusSeconds(1))
        `when`(reports.listForOperations(request)).thenReturn(PageImpl(listOf(row(first), row(second)), request, 45))
        coreNames("r1" to "닉1", "r2" to "닉2")

        assertEquals(
            OperationsFeedbackReportPageResponse(
                listOf(
                    OperationsFeedbackReportResponse("a", "w-a", "작품-a", 2, "typo", "본문-a", "인용 문장", "private", "unchecked", "닉1", false, t0),
                    OperationsFeedbackReportResponse("b", "w-b", "작품-b", 2, "typo", "본문-b", null, "private", "answered", "닉2", true, t0.plusSeconds(1)),
                ),
                page = 0, size = 20, totalElements = 45, totalPages = 3,
            ),
            service.list(null, null, null),
        )
        // 목록 쿼리 한 번이고 제보·작품 단건 조회는 없다(작품 제목은 같은 쿼리의 행에 든다).
        verify(reports).listForOperations(request)
        verifyNoMoreInteractions(reports)
    }

    @Test fun `a status filter and the requested window select the status query with that page`() {
        val request = PageRequest.of(2, 5)
        `when`(reports.listForOperationsByStatus("checked", request)).thenReturn(PageImpl(listOf(row(report("c", status = "checked"))), request, 11))
        coreNames("r1" to "닉1")

        val page = service.list("checked", "2", "5")

        assertEquals(listOf("c"), page.items.map { it.id })
        assertEquals(2, page.page)
        assertEquals(5, page.size)
        assertEquals(11L, page.totalElements)
        assertEquals(3, page.totalPages)
        verify(reports).listForOperationsByStatus("checked", request)
        verifyNoMoreInteractions(reports)
    }

    @Test fun `every known status selects its own status query`() {
        for (status in listOf("unchecked", "checked", "answered", "resolved", "closed")) {
            val request = PageRequest.of(0, 20)
            `when`(reports.listForOperationsByStatus(status, request)).thenReturn(PageImpl(emptyList(), request, 0))
            assertEquals(emptyList<OperationsFeedbackReportResponse>(), service.list(status, null, null).items, status)
            verify(reports).listForOperationsByStatus(status, request)
        }
    }

    @Test fun `an unknown status or a malformed page or size is 422 before anything is read`() {
        // held·pending은 수정 제안의 상태라 제보 필터가 아니다.
        for (bad in listOf("held", "pending", "UNCHECKED", "")) assertEquals(422, rejected { service.list(bad, null, null) }.status, bad)
        for (bad in listOf("-1", "abc", "", "1.5")) assertEquals(422, rejected { service.list(null, bad, null) }.status, "page=" + bad)
        for (bad in listOf("0", "101", "x", "")) assertEquals(422, rejected { service.list(null, null, bad) }.status, "size=" + bad)
        verifyNoInteractions(reports, nicknames)
    }

    @Test fun `all reporters of the page are looked up from Core in a single call and a missing one is a withdrawn member`() {
        val request = PageRequest.of(0, 20)
        `when`(reports.listForOperations(request)).thenReturn(PageImpl(listOf(row(report("a", reporter = "r1")), row(report("b", reporter = "r2")), row(report("c", reporter = "r1"))), request, 3))
        val asked = mutableListOf<Collection<*>>()
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            asked += call.arguments[0] as Collection<*>
            mapOf("r1" to "닉1")
        }

        assertEquals(listOf("닉1", WITHDRAWN_MEMBER_NAME, "닉1"), service.list(null, null, null).items.map { it.reporterName })
        assertEquals(setOf("r1", "r2"), asked.single().toSet())
    }

    @Test fun `a Core failure fails the list and is never replaced by a name`() {
        val request = PageRequest.of(0, 20)
        `when`(reports.listForOperations(request)).thenReturn(PageImpl(listOf(row(report("a"))), request, 1))
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        assertSame(failure, assertThrows(CoreAuthException::class.java) { service.list(null, null, null) })
    }

    @Test fun `no reports is an empty page and Core is not called`() {
        val request = PageRequest.of(0, 20)
        val core = mock(CoreAuthClient::class.java)
        `when`(reports.listForOperations(request)).thenReturn(PageImpl(emptyList(), request, 0))

        assertEquals(
            OperationsFeedbackReportPageResponse(emptyList(), 0, 20, 0, 0),
            InternalFeedbackReportService(reports, CoreNicknameService(core)).list(null, null, null),
        )
        verifyNoInteractions(core)
    }

    @Test fun `the response serializes to the contract field names`() {
        val json = JsonMapper.builder().findAndAddModules().build()
        val page = OperationsFeedbackReportPageResponse(
            listOf(OperationsFeedbackReportResponse("a", "w1", "작품", 3, "story", "본문", null, "public", "resolved", "닉", true, t0)),
            page = 1, size = 20, totalElements = 21, totalPages = 2,
        )
        val tree = json.readTree(json.writeValueAsString(page))

        assertEquals(setOf("items", "page", "size", "totalElements", "totalPages"), tree.propertyNames().toSet())
        val item = tree.path("items")[0]
        assertEquals(
            setOf("id", "workId", "workTitle", "episodeNumber", "kind", "body", "quote", "visibility", "status", "reporterName", "withdrawn", "createdAt"),
            item.propertyNames().toSet(),
        )
        assertEquals("2026-11-20T01:02:03Z", item.path("createdAt").asString())
        assertTrue(item.path("quote").isNull)
        assertEquals(listOf(true, 3), listOf(item.path("withdrawn").asBoolean(), item.path("episodeNumber").asInt()))
    }
}
