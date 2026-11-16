package ai.storyfork.content.notice

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.notice.entity.WorkNoticeEntity
import ai.storyfork.content.notice.repository.WorkNoticeRepository
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.notice.service.dto.WorkNoticeListResponse
import ai.storyfork.content.notice.service.dto.WorkNoticeRequest
import ai.storyfork.content.notice.service.dto.WorkNoticeResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.data.domain.Sort
import org.springframework.data.repository.query.parser.PartTree

/**
 * 작품 소식(공지) 규칙을 DB 없이 검증한다. 작품 접근은 WorkAccessService와 같은 규칙(없으면 404, 공개 목록은 공개 작품만)의 메모리 대역이고,
 * 저장소는 삭제 제외(deleted_at IS NULL)와 작품 일치 조회를 흉내 낸다. 실제 SQL·Security·HTTP는 CI의 WorkNoticePostgresTest가 확인한다.
 * 보이지 않는 문자는 소스에 적지 않고 코드로 만든다.
 */
class WorkNoticeServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val notices = mock(WorkNoticeRepository::class.java)
    private val service = WorkNoticeService(access, notices)
    private val works = mutableMapOf<String, WorkAccessResult>()
    private val rows = mutableListOf<WorkNoticeEntity>()
    // 수정 시각이 항상 이보다 늦도록 충분히 오래된 고정 시각이다.
    private val t0 = Instant.parse("2020-01-01T00:00:00Z")
    private val nbsp = Char(0xA0)
    private val nul = Char(0)

    private fun anyNotice() = ArgumentMatchers.any(WorkNoticeEntity::class.java) ?: WorkNoticeEntity()

    init {
        `when`(access.get(ArgumentMatchers.anyString())).thenAnswer { call -> works[call.arguments[0]] ?: throw ContentFailure(404, "작품을 찾을 수 없어요.") }
        `when`(access.published(ArgumentMatchers.anyString())).thenAnswer { call ->
            val work = works[call.arguments[0]] ?: throw ContentFailure(404, "작품을 찾을 수 없어요.")
            if (!work.publiclyVisible()) throw ContentFailure(404, "공개 작품을 찾을 수 없어요.")
            work
        }
        `when`(notices.save(anyNotice())).thenAnswer { call -> (call.arguments[0] as WorkNoticeEntity).also { rows.add(it) } }
        `when`(notices.findTop200ByWorkIdAndDeletedAtIsNullOrderByPinnedDescCreatedAtDescIdDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            rows.filter { it.workId == call.arguments[0] && it.deletedAt == null }
                .sortedWith(compareByDescending<WorkNoticeEntity> { it.pinned }.thenByDescending { it.createdAt }.thenByDescending { it.id }).take(200)
        }
        `when`(notices.findByIdAndWorkIdAndDeletedAtIsNull(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            rows.firstOrNull { it.id == call.arguments[0] && it.workId == call.arguments[1] && it.deletedAt == null }
        }
    }

    private fun work(id: String = "work", owner: String = "author", visibility: String = "public", restricted: Boolean = false, deleted: Boolean = false) =
        WorkAccessResult(id, owner, "제목", "소개", 1, "world", visibility, false, false, null, restricted, deleted).also { works[id] = it }
    private fun notice(id: String, work: String = "work", at: Instant = t0, pinned: Boolean = false, deleted: Boolean = false, author: String = "author") =
        WorkNoticeEntity(id = id, workId = work, authorId = author, category = "info", title = "제목 $id", body = "본문 $id", pinned = pinned,
            createdAt = at, updatedAt = at, deletedAt = if (deleted) at.plusSeconds(1) else null).also { rows.add(it) }
    private fun request(category: String = "info", title: String = "제목", body: String = "본문", pinned: Boolean = false) = WorkNoticeRequest(category, title, body, pinned)
    private fun status(block: () -> Unit) = assertThrows(ContentFailure::class.java, block).status

    @Test fun `JSON field names follow the contract and a sparse request body falls back to defaults`() {
        val mapper = tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()

        val response = WorkNoticeResponse("n1", "work", "event", "제목", "본문", true, t0, t0)
        val item = mapper.readTree(mapper.writeValueAsString(WorkNoticeListResponse(listOf(response)))).path("items")[0]

        assertEquals(listOf("body", "category", "createdAt", "id", "pinned", "title", "updatedAt", "workId"), item.propertyNames().toList().sorted())
        assertEquals("2020-01-01T00:00:00Z", item.path("createdAt").asString())
        assertEquals("event", item.path("category").asString())
        assertTrue(item.path("pinned").asBoolean())
        assertEquals(WorkNoticeRequest("info", "제목", "본문", false), mapper.readValue("""{"category":"info","title":"제목","body":"본문"}""", WorkNoticeRequest::class.java))
        assertEquals(WorkNoticeRequest(), mapper.readValue("{}", WorkNoticeRequest::class.java))
    }

    @Test fun `create trims the text, keeps the writer and answers with the contract fields`() {
        work()

        val created = service.create("work", "author", false, request("hiatus", "  휴재 안내  ", "${nbsp}다음 주는 쉽니다.\n", true))

        val saved = rows.single()
        assertEquals(listOf<Any?>("work", "author", "hiatus", "휴재 안내", "다음 주는 쉽니다.", true), listOf(saved.workId, saved.authorId, saved.category, saved.title, saved.body, saved.pinned))
        assertEquals(saved.id, UUID.fromString(saved.id).toString())
        assertNull(saved.deletedAt)
        assertEquals(saved.createdAt, saved.updatedAt)
        assertEquals(WorkNoticeResponse(saved.id, "work", "hiatus", "휴재 안내", "다음 주는 쉽니다.", true, saved.createdAt, saved.updatedAt), created)
        verify(access).get("work")
    }

    @Test fun `the owner prepares notices on a private work and an operator may write to any work`() {
        work("draft", visibility = "private")

        service.create("draft", "author", false, request(title = "준비 중"))
        service.create("draft", "admin", true, request(title = "운영 공지"))

        assertEquals(listOf("author", "admin"), rows.map { it.authorId })
        assertEquals(listOf("준비 중", "운영 공지"), rows.map { it.title })
        // 공개 목록은 공개 작품에서만 보인다.
        assertEquals(404, status { service.list("draft") })
    }

    @Test fun `a member who is neither the owner nor an operator gets 403 and nothing changes`() {
        work()
        val mine = notice("n1")

        assertEquals(403, status { service.create("work", "stranger", false, request()) })
        assertEquals(403, status { service.update("work", "n1", "stranger", false, request(title = "가로채기", pinned = true)) })
        assertEquals(403, status { service.delete("work", "n1", "stranger", false) })
        // 권한은 작품 단위라 공지가 없어도 404가 아니라 403이다(공지의 존재를 알리지 않는다).
        assertEquals(403, status { service.update("work", "missing", "stranger", false, request()) })
        assertEquals(403, status { service.delete("work", "missing", "stranger", false) })

        assertEquals(listOf(mine), rows)
        assertEquals(listOf<Any?>("제목 n1", false), listOf(mine.title, mine.pinned))
        assertNull(mine.deletedAt)
    }

    @Test fun `input errors are 422 before the work is looked up or the writer is checked`() {
        work(); work("gone", deleted = true)
        val bad = request(title = "")

        // 없는 작품·삭제된 작품·타인의 작품 모두 404·403보다 먼저 422다.
        for ((id, member) in listOf("missing" to "author", "gone" to "author", "work" to "stranger")) {
            assertEquals(422, status { service.create(id, member, false, bad) }, "create $id $member")
            assertEquals(422, status { service.update(id, "n1", member, false, bad) }, "update $id $member")
        }

        assertTrue(rows.isEmpty())
        verifyNoInteractions(access, notices)
    }

    @Test fun `blank NBSP-only NUL over-long text and an unknown category are rejected and nothing is stored or changed`() {
        work()
        val id = service.create("work", "author", false, request(title = "원래 제목", body = "원래 본문")).id
        val bad = listOf(
            request(title = ""), request(title = "   "), request(title = "$nbsp$nbsp"), request(title = "가".repeat(201)), request(title = "제목$nul"),
            request(body = ""), request(body = "  \n "), request(body = "$nbsp"), request(body = "가".repeat(20_001)), request(body = "본문$nul"),
            request(category = ""), request(category = "notice"), request(category = "INFO"), request(category = " info"),
        )

        for (data in bad) {
            assertEquals(422, status { service.create("work", "author", false, data) }, data.toString().take(60))
            assertEquals(422, status { service.update("work", id, "author", false, data) }, data.toString().take(60))
        }

        val saved = rows.single()
        assertEquals(listOf("원래 제목", "원래 본문"), listOf(saved.title, saved.body))
    }

    @Test fun `the length limits count after trimming and the exact maximum is accepted`() {
        work()

        val created = service.create("work", "author", false, request(title = " " + "가".repeat(200) + nbsp, body = "\n" + "나".repeat(20_000) + " "))

        assertEquals(listOf(200, 20_000), listOf(created.title.length, created.body.length))
    }

    @Test fun `the public list maps the repository rows after the public access check`() {
        work()
        notice("p", pinned = true); notice("a")

        // 정렬·삭제 제외는 저장소 쿼리의 몫이라 아래 PartTree 테스트와 CI에서 확인한다.
        assertEquals(listOf("p" to true, "a" to false), service.list("work").items.map { it.id to it.pinned })
        verify(access).published("work")
    }

    @Test fun `the repository query orders pinned first then newest then id and caps at 200`() {
        // 파생 쿼리명이 틀리면 Spring 컨텍스트 기동이 실패해 CI 통합 테스트 전체가 깨지므로 DB 없이 이름·정렬·개수를 고정한다.
        val queries = WorkNoticeRepository::class.java.declaredMethods.associate { it.name to PartTree(it.name, WorkNoticeEntity::class.java) }
        val list = queries.getValue("findTop200ByWorkIdAndDeletedAtIsNullOrderByPinnedDescCreatedAtDescIdDesc")

        assertEquals(200, list.maxResults)
        assertEquals(Sort.by(Sort.Order.desc("pinned"), Sort.Order.desc("createdAt"), Sort.Order.desc("id")), list.sort)
        assertEquals(setOf("findTop200ByWorkIdAndDeletedAtIsNullOrderByPinnedDescCreatedAtDescIdDesc", "findByIdAndWorkIdAndDeletedAtIsNull"), queries.keys)
    }

    @Test fun `a private restricted deleted or unknown work has no public list`() {
        work("private", visibility = "private"); work("restricted", restricted = true); work("deleted", deleted = true)

        for (id in listOf("private", "restricted", "deleted", "unknown")) assertEquals(404, status { service.list(id) }, id)
    }

    @Test fun `a deleted or unknown work is 404 for writes even for its owner and an operator`() {
        work("gone", deleted = true)

        for ((id, member, operator) in listOf(Triple("gone", "author", false), Triple("gone", "admin", true), Triple("missing", "author", false), Triple("missing", "admin", true))) {
            assertEquals(404, status { service.create(id, member, operator, request()) }, "create $id $member")
            assertEquals(404, status { service.update(id, "n1", member, operator, request()) }, "update $id $member")
            assertEquals(404, status { service.delete(id, "n1", member, operator) }, "delete $id $member")
        }

        assertTrue(rows.isEmpty())
    }

    @Test fun `update replaces every field including the pin and keeps the first writer and the creation time`() {
        work()
        val row = notice("n1", pinned = true, author = "author")

        val updated = service.update("work", "n1", "admin", true, request("event", " 이벤트 ", "이벤트 본문", false))

        assertEquals(listOf<Any?>("event", "이벤트", "이벤트 본문", false, "author", t0), listOf(row.category, row.title, row.body, row.pinned, row.authorId, row.createdAt))
        assertTrue(row.updatedAt > t0)
        assertEquals(WorkNoticeResponse("n1", "work", "event", "이벤트", "이벤트 본문", false, t0, row.updatedAt), updated)
        // 고정은 해제만이 아니라 다시 설정할 수도 있다.
        assertTrue(service.update("work", "n1", "author", false, request(pinned = true)).pinned)
    }

    @Test fun `delete only records deleted_at and the notice then disappears from list update and delete`() {
        work()
        val row = notice("n1")
        notice("n2", at = t0.plusSeconds(1))

        service.delete("work", "n1", "author", false)

        assertNotNull(row.deletedAt)
        assertEquals(2, rows.size)
        assertEquals(listOf("n2"), service.list("work").items.map { it.id })
        assertEquals(404, status { service.update("work", "n1", "author", false, request()) })
        assertEquals(404, status { service.delete("work", "n1", "author", false) })
        assertEquals(404, status { service.delete("work", "n1", "admin", true) })
    }

    @Test fun `a notice of another work is 404 for the owner and for an operator`() {
        work("w1"); work("w2", owner = "other")
        val foreign = notice("n2", work = "w2")

        assertEquals(404, status { service.update("w1", "n2", "author", false, request()) })
        assertEquals(404, status { service.delete("w1", "n2", "author", false) })
        assertEquals(404, status { service.update("w1", "n2", "admin", true, request()) })
        assertEquals(404, status { service.delete("w1", "n2", "admin", true) })

        assertNull(foreign.deletedAt)
        assertEquals("제목 n2", foreign.title)
    }
}
