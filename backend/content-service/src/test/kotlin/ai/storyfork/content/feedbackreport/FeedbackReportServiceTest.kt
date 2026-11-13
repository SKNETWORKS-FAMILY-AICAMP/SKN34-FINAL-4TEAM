package ai.storyfork.content.feedbackreport

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.feedbackreport.entity.FeedbackReportAmendmentEntity
import ai.storyfork.content.feedbackreport.entity.FeedbackReportEntity
import ai.storyfork.content.feedbackreport.entity.FeedbackReportResponseEntity
import ai.storyfork.content.feedbackreport.repository.FeedbackReportAmendmentRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportResponseRepository
import ai.storyfork.content.feedbackreport.service.FeedbackReportService
import ai.storyfork.content.feedbackreport.service.dto.*
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*

/**
 * 제보 관리 규칙(계약 1절)을 DB 없이 검증한다. 저장소는 작품·회차 일치 조회를 흉내 내는 메모리 대역이고,
 * 표시명의 정본인 Core 닉네임은 "<회원 id>-닉"을 돌려주는 대역이다([withdrawn]에 넣은 회원은 Core에 없다).
 * 실제 SQL·Security·HTTP는 CI의 FeedbackReportIntegrationTest가 확인한다.
 */
class FeedbackReportServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val works = mock(WorkRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val reports = mock(FeedbackReportRepository::class.java)
    private val amendments = mock(FeedbackReportAmendmentRepository::class.java)
    private val responses = mock(FeedbackReportResponseRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = FeedbackReportService(access, works, current, reports, amendments, responses, nicknames)
    private val rows = mutableListOf<FeedbackReportEntity>()
    private val amendmentRows = mutableListOf<FeedbackReportAmendmentEntity>()
    private val replyRows = mutableListOf<FeedbackReportResponseEntity>()
    private val workRows = mutableMapOf<String, WorkAccessResult>()
    // Core에 없는(탈퇴한) 회원 id와, Core에 물은 id 묶음(호출마다 하나)이다.
    private val withdrawn = mutableSetOf<String>()
    private val asked = mutableListOf<List<String>>()
    // 수정 시각이 항상 이보다 늦도록 충분히 오래된 고정 시각이다.
    private val t0 = Instant.parse("2020-01-01T00:00:00Z")

    private fun anyReport() = ArgumentMatchers.any(FeedbackReportEntity::class.java) ?: FeedbackReportEntity()
    private fun anyAmendment() = ArgumentMatchers.any(FeedbackReportAmendmentEntity::class.java) ?: FeedbackReportAmendmentEntity()
    private fun anyReply() = ArgumentMatchers.any(FeedbackReportResponseEntity::class.java) ?: FeedbackReportResponseEntity()

    init {
        `when`(access.get(ArgumentMatchers.anyString())).thenAnswer { call -> workRows[call.arguments[0]] ?: throw ContentFailure(404, "작품을 찾을 수 없어요.") }
        `when`(access.published(ArgumentMatchers.anyString())).thenAnswer { call ->
            (workRows[call.arguments[0]] ?: throw ContentFailure(404, "작품을 찾을 수 없어요.")).also { if (!it.publiclyVisible()) throw ContentFailure(404, "공개 작품을 찾을 수 없어요.") }
        }
        `when`(works.findAllById(ArgumentMatchers.anyIterable<String>())).thenAnswer { call ->
            workRows.values.filter { it.id in (call.arguments[0] as Iterable<*>) }.map { WorkEntity(id = it.id, ownerId = it.ownerId, title = it.title) }
        }
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            workRows.values.filter { it.ownerId == call.arguments[0] }.map { WorkEntity(id = it.id, ownerId = it.ownerId, title = it.title, deletedAt = if (it.deleted) t0 else null) }
        }
        `when`(reports.save(anyReport())).thenAnswer { call -> (call.arguments[0] as FeedbackReportEntity).also { if (it !in rows) rows.add(it) } }
        `when`(amendments.save(anyAmendment())).thenAnswer { call -> (call.arguments[0] as FeedbackReportAmendmentEntity).also { amendmentRows.add(it) } }
        `when`(responses.save(anyReply())).thenAnswer { call -> (call.arguments[0] as FeedbackReportResponseEntity).also { replyRows.add(it) } }
        `when`(reports.findTop200ByWorkIdAndEpisodeNumberOrderByCreatedAtDesc(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())).thenAnswer { call ->
            rows.filter { it.workId == call.arguments[0] && it.episodeNumber == call.arguments[1] }.sortedByDescending { it.createdAt }.take(200)
        }
        `when`(reports.findByIdAndWorkIdAndEpisodeNumber(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())).thenAnswer { call ->
            rows.firstOrNull { it.id == call.arguments[0] && it.workId == call.arguments[1] && it.episodeNumber == call.arguments[2] }
        }
        `when`(reports.lockByIdAndWorkId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            rows.firstOrNull { it.id == call.arguments[0] && it.workId == call.arguments[1] }
        }
        `when`(reports.findTop200ByReporterIdOrderByCreatedAtDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            rows.filter { it.reporterId == call.arguments[0] }.sortedByDescending { it.createdAt }.take(200)
        }
        `when`(reports.findTop200ByWorkIdInOrderByCreatedAtDesc(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            rows.filter { it.workId in (call.arguments[0] as Collection<*>) }.sortedByDescending { it.createdAt }.take(200)
        }
        `when`(amendments.findAllByReportIdIn(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            amendmentRows.filter { it.reportId in (call.arguments[0] as Collection<*>) }
        }
        `when`(responses.findAllByReportIdIn(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            replyRows.filter { it.reportId in (call.arguments[0] as Collection<*>) }
        }
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            val ids = (call.arguments[0] as Collection<*>).map { it as String }
            asked += ids
            ids.filter { it !in withdrawn }.associateWith { "$it-닉" }
        }
    }

    private fun work(id: String = "work", owner: String = "author", public: Boolean = true, deleted: Boolean = false) {
        workRows[id] = WorkAccessResult(id, owner, "$id 제목", "소개", 1, "world", if (public) "public" else "private", false, false, null, false, deleted)
    }
    private fun published(number: Int = 1, version: String? = "version-$number", work: String = "work") {
        `when`(current.findByWorkIdAndSequence(work, number)).thenReturn(EpisodeCurrentEntity("episode-$number", work, number, version))
    }
    private fun report(id: String, reporter: String = "reporter", visibility: String = "public", status: String = "unchecked", at: Instant = t0,
        work: String = "work", number: Int = 1, kind: String = "typo", body: String = "본문", quote: String? = null) =
        FeedbackReportEntity(id = id, workId = work, episodeNumber = number, publishedVersionId = "version-$number", reporterId = reporter, kind = kind,
            body = body, quote = quote, visibility = visibility, status = status, createdAt = at, updatedAt = at).also { rows.add(it) }
    private fun reply(report: String, body: String = "답변", isPublic: Boolean = false, author: String = "author", at: Instant = t0) =
        FeedbackReportResponseEntity(id = "reply-${replyRows.size}", reportId = report, authorId = author, body = body, isPublic = isPublic, createdAt = at).also { replyRows.add(it) }
    private fun failure(block: () -> Any?) = assertThrows(ContentFailure::class.java) { block() }

    @Test fun `JSON field names follow the contract and sparse request bodies fall back to defaults`() {
        val mapper = tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        val item = ReportResponse("r1", "work", "작품", 3, "version-3", "typo", "본문", null, "private", "unchecked", "닉", false, false, false, false,
            listOf(AmendmentResponse("correct", "고침", t0)), listOf(ReportReplyResponse("p1", "작가", "답변", true, t0)), t0, t0)

        val json = mapper.readTree(mapper.writeValueAsString(ReportListResponse(listOf(item)))).path("items")[0]

        assertEquals(listOf("amendments", "authorChecked", "body", "createdAt", "episodeNumber", "id", "kind", "mine", "owner", "publishedVersionId", "quote", "reporterName",
            "responses", "status", "updatedAt", "visibility", "withdrawn", "workId", "workTitle"), json.propertyNames().toList().sorted())
        assertTrue(json.path("quote").isNull)
        assertEquals(listOf("action", "body", "createdAt"), json.path("amendments")[0].propertyNames().toList().sorted())
        assertEquals(listOf("authorName", "body", "createdAt", "id", "isPublic"), json.path("responses")[0].propertyNames().toList().sorted())
        assertTrue(json.path("responses")[0].path("isPublic").asBoolean())
        assertEquals("2020-01-01T00:00:00Z", json.path("createdAt").asString())
        assertEquals(CreateReportRequest("typo", "본문"), mapper.readValue("""{"kind":"typo","body":"본문"}""", CreateReportRequest::class.java))
        assertEquals(CreateReportRequest("story", "본문", "인용", "public"), mapper.readValue("""{"kind":"story","body":"본문","quote":"인용","visibility":"public"}""", CreateReportRequest::class.java))
        assertEquals(ResponseRequest("답변", true), mapper.readValue("""{"body":"답변","isPublic":true}""", ResponseRequest::class.java))
        assertEquals(ResponseRequest("답변", false), mapper.readValue("""{"body":"답변"}""", ResponseRequest::class.java))
        assertEquals(StatusRequest(), mapper.readValue("{}", StatusRequest::class.java))
    }

    @Test fun `create pins the published version stores trimmed text defaults to private and answers with the Core nickname`() {
        work(); published(3, "version-3a")

        val created = service.create("work", 3, "reader", CreateReportRequest("typo", "  오탈자예요  ", " 인용 문장 ", null))

        val saved = rows.single()
        assertEquals(listOf<Any?>("work", 3, "version-3a", "reader", "typo", "오탈자예요", "인용 문장", "private", "unchecked"),
            listOf(saved.workId, saved.episodeNumber, saved.publishedVersionId, saved.reporterId, saved.kind, saved.body, saved.quote, saved.visibility, saved.status))
        assertEquals(saved.id, UUID.fromString(saved.id).toString())
        assertNull(saved.authorCheckedAt)
        assertNull(saved.withdrawnAt)
        assertEquals(saved.createdAt, saved.updatedAt)
        assertEquals(listOf<Any?>(saved.id, "work", "work 제목", 3, "version-3a", "typo", "오탈자예요", "인용 문장", "private", "unchecked", "reader-닉"),
            listOf(created.id, created.workId, created.workTitle, created.episodeNumber, created.publishedVersionId, created.kind, created.body, created.quote,
                created.visibility, created.status, created.reporterName))
        assertEquals(listOf(true, false, false, false), listOf(created.mine, created.owner, created.authorChecked, created.withdrawn))
        assertTrue(created.amendments.isEmpty() && created.responses.isEmpty())
        assertEquals(listOf(listOf("reader")), asked)
        verify(access).published("work")
    }

    @Test fun `a blank quote is stored as null and the owner may report on their own work`() {
        work(); published()

        val own = service.create("work", 1, "author", CreateReportRequest("question", "질문이에요", "   ", "public"))

        assertNull(rows.single().quote)
        assertEquals(listOf(true, true, "public"), listOf(own.mine, own.owner, own.visibility))
    }

    @Test fun `each report keeps the version published when it was written even after a newer one is published`() {
        work()
        published(1, "version-1")
        val first = service.create("work", 1, "reader", CreateReportRequest("typo", "첫 제보", visibility = "public"))
        published(1, "version-2")
        val second = service.create("work", 1, "reader", CreateReportRequest("typo", "둘째 제보", visibility = "public"))

        val shown = service.list("work", 1, "reader").items.associate { it.id to it.publishedVersionId }
        assertEquals(mapOf(first.id to "version-1", second.id to "version-2"), shown)
    }

    @Test fun `invalid input is 422 before any access check and stores nothing`() {
        // 작품이 없어 접근 판정을 하면 404가 되지만, 입력 검증이 먼저라 모두 422다.
        val tooLong = "가".repeat(501)
        val calls = listOf<() -> Any?>(
            { service.create("none", 1, "reader", CreateReportRequest("comment", "본문")) },
            { service.create("none", 1, "reader", CreateReportRequest("typo", "   ")) },
            { service.create("none", 1, "reader", CreateReportRequest("typo", tooLong)) },
            { service.create("none", 1, "reader", CreateReportRequest("typo", "본문", tooLong)) },
            { service.create("none", 1, "reader", CreateReportRequest("typo", "본문", visibility = "friends")) },
            { service.setVisibility("none", "r1", "reporter", VisibilityRequest()) },
            { service.setVisibility("none", "r1", "reporter", VisibilityRequest("friends")) },
            { service.correct("none", "r1", "reporter", CorrectionRequest("  ")) },
            { service.answer("none", "r1", "author", ResponseRequest("가".repeat(2001))) },
            { service.setStatus("none", "r1", "author", StatusRequest("unchecked")) },
        )
        for (call in calls) assertEquals(422, failure(call).status)
        verifyNoInteractions(access)
        assertTrue(rows.isEmpty() && amendmentRows.isEmpty() && replyRows.isEmpty())
    }

    @Test fun `create is 404 for a private work and for an unpublished episode`() {
        work("hidden", public = false); published(work = "hidden")
        work(); `when`(current.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeCurrentEntity("episode-2", "work", 2, null))

        assertEquals(404, failure { service.create("hidden", 1, "reader", CreateReportRequest("typo", "본문")) }.status)
        assertEquals(404, failure { service.create("work", 2, "reader", CreateReportRequest("typo", "본문")) }.status)
        assertEquals(404, failure { service.create("work", 9, "reader", CreateReportRequest("typo", "본문")) }.status)
        assertTrue(rows.isEmpty())
    }

    @Test fun `an episode list shows each viewer exactly what they may read newest first`() {
        work(); published()
        report("p1", reporter = "r1", visibility = "public", at = t0.plusSeconds(1), body = "공개 제보")
        report("p2", reporter = "r1", visibility = "private", at = t0.plusSeconds(2), body = "내 비공개")
        report("p3", reporter = "r2", visibility = "private", at = t0.plusSeconds(3), body = "남의 비공개 원문", quote = "남의 인용")
        reply("p3", body = "비공개 답변", isPublic = false)
        reply("p3", body = "공개 답변", isPublic = true, at = t0.plusSeconds(1))
        report("p4", reporter = "r2", visibility = "private", at = t0.plusSeconds(4), body = "답변 없는 남의 비공개")
        report("p5", reporter = "r2", visibility = "public", at = t0.plusSeconds(5), body = "공개 제보 둘")
        reply("p5", body = "비공개 답변 둘", isPublic = false)

        fun ids(viewer: String?) = service.list("work", 1, viewer).items.map { it.id }

        // 익명·낯선 사람: 공개 제보와, 비공개 제보 중 공개 답변이 있는 것(원문 숨김)만 최신순으로 본다.
        assertEquals(listOf("p5", "p3", "p1"), ids(null))
        assertEquals(listOf("p5", "p3", "p1"), ids("stranger"))
        // 제보자는 자기 비공개 제보까지, 소유자는 모든 제보를 본다.
        assertEquals(listOf("p5", "p3", "p2", "p1"), ids("r1"))
        assertEquals(listOf("p5", "p4", "p3", "p1"), ids("r2"))
        assertEquals(listOf("p5", "p4", "p3", "p2", "p1"), ids("author"))

        val anonymous = service.list("work", 1, null).items.associateBy { it.id }
        // 원문을 볼 수 없는 제보: 원문·인용·제보자 이름·정정은 없고 공개 답변만 남는다.
        val hidden = anonymous.getValue("p3")
        assertEquals(listOf<Any?>(null, null, null, emptyList<AmendmentResponse>()), listOf(hidden.body, hidden.quote, hidden.reporterName, hidden.amendments))
        assertEquals(listOf("공개 답변"), hidden.responses.map { it.body })
        assertEquals(listOf("private", "unchecked", false, false), listOf(hidden.visibility, hidden.status, hidden.mine, hidden.owner))
        // 공개 제보의 비공개 답변은 제3자에게 보이지 않는다.
        assertEquals(listOf("공개 제보 둘", "r2-닉", emptyList<String>()), anonymous.getValue("p5").let { listOf(it.body, it.reporterName, it.responses.map { r -> r.body }) })
        // 제보자와 소유자는 비공개 답변까지 모두 본다(오래된 순).
        assertEquals(listOf("비공개 답변", "공개 답변"), service.list("work", 1, "r2").items.first { it.id == "p3" }.responses.map { it.body })
        assertEquals(listOf("비공개 답변", "공개 답변"), service.list("work", 1, "author").items.first { it.id == "p3" }.responses.map { it.body })
        assertEquals(listOf(true, false), service.list("work", 1, "r2").items.first { it.id == "p3" }.let { listOf(it.mine, it.owner) })
        assertEquals(listOf(false, true), service.list("work", 1, "author").items.first { it.id == "p3" }.let { listOf(it.mine, it.owner) })
    }

    @Test fun `a list never asks Core for the reporter of a report whose text is hidden`() {
        work(); published()
        report("p3", reporter = "secret-reporter", visibility = "private")
        reply("p3", body = "공개 답변", isPublic = true, author = "writer")

        val hidden = service.list("work", 1, null).items.single()

        assertNull(hidden.reporterName)
        assertEquals(listOf(listOf("writer")), asked)
        assertEquals("writer-닉", hidden.responses.single().authorName)
    }

    @Test fun `a list asks Core once for its distinct people and an empty list never asks`() {
        work(); published()
        report("p1", reporter = "a"); report("p2", reporter = "b", at = t0.plusSeconds(1)); report("p3", reporter = "a", at = t0.plusSeconds(2))
        reply("p1", isPublic = true, author = "author")

        service.list("work", 1, null)

        assertEquals(1, asked.size)
        assertEquals(setOf("a", "b", "author"), asked.single().toSet())
        rows.clear(); asked.clear()
        assertEquals(emptyList<ReportResponse>(), service.list("work", 1, null).items)
        assertTrue(asked.isEmpty())
    }

    @Test fun `names follow the latest Core nickname and a member Core no longer knows is the withdrawn member`() {
        work(); published()
        report("p1", reporter = "gone")
        reply("p1", isPublic = true, author = "author")
        withdrawn += "gone"

        val item = service.list("work", 1, null).items.single()

        assertEquals("탈퇴한 회원", item.reporterName)
        assertEquals("author-닉", item.responses.single().authorName)
        // 쓰기 응답도 같다. 제보자 본인이 Core에서 사라졌어도 이름을 지어내지 않는다.
        assertEquals("탈퇴한 회원", service.create("work", 1, "gone", CreateReportRequest("typo", "남긴 글")).reporterName)
    }

    @Test fun `a Core failure fails the operation and is never replaced by a name`() {
        work(); published()
        report("p1")
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        val calls = listOf<Pair<String, () -> Any?>>(
            "list" to { service.list("work", 1, null) },
            "read" to { service.read("work", 1, "p1", null) },
            "create" to { service.create("work", 1, "reader", CreateReportRequest("typo", "본문")) },
            "mine" to { service.mine("reporter") },
            "inbox" to { service.inbox("author") },
            "check" to { service.check("work", "p1", "author") },
        )
        for ((name, call) in calls) assertSame(failure, assertThrows(CoreAuthException::class.java) { call() }, name)
    }

    @Test fun `list and read are 404 for a private work and an unpublished episode`() {
        work("hidden", public = false); published(work = "hidden")
        report("p1", work = "hidden")
        work(); `when`(current.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeCurrentEntity("episode-2", "work", 2, null))
        report("p2", number = 2)

        assertEquals(404, failure { service.list("hidden", 1, "reporter") }.status)
        assertEquals(404, failure { service.read("hidden", 1, "p1", "reporter") }.status)
        assertEquals(404, failure { service.list("work", 2, "reporter") }.status)
        assertEquals(404, failure { service.read("work", 2, "p2", "reporter") }.status)
    }

    @Test fun `detail follows the same visibility as the list and a report of another work or episode is 404`() {
        work(); published(); published(2)
        report("pub", reporter = "r1", visibility = "public")
        report("priv", reporter = "r1", visibility = "private")
        report("answered", reporter = "r1", visibility = "private"); reply("answered", body = "공개 답변", isPublic = true)

        assertEquals("본문", service.read("work", 1, "pub", null).body)
        assertEquals("본문", service.read("work", 1, "priv", "r1").body)
        assertEquals("본문", service.read("work", 1, "priv", "author").body)
        assertEquals(404, failure { service.read("work", 1, "priv", null) }.status)
        assertEquals(404, failure { service.read("work", 1, "priv", "stranger") }.status)
        val answered = service.read("work", 1, "answered", null)
        assertEquals(listOf<Any?>(null, null, listOf("공개 답변")), listOf(answered.body, answered.reporterName, answered.responses.map { it.body }))
        assertEquals(404, failure { service.read("work", 2, "pub", null) }.status)
        assertEquals(404, failure { service.read("work", 1, "missing", null) }.status)
    }

    @Test fun `mine lists only my reports across works with the work title and owner flag`() {
        work(); work("mine-work", owner = "me")
        report("a", reporter = "me", at = t0.plusSeconds(1)); report("b", reporter = "me", work = "mine-work", visibility = "private", at = t0.plusSeconds(2))
        report("c", reporter = "other", at = t0.plusSeconds(3))
        reply("a", body = "비공개 답변", isPublic = false)

        val items = service.mine("me").items

        assertEquals(listOf("b", "a"), items.map { it.id })
        assertEquals(listOf("mine-work 제목", "work 제목"), items.map { it.workTitle })
        assertEquals(listOf(true, false), items.map { it.owner })
        assertTrue(items.all { it.mine })
        assertEquals(listOf("본문", "본문"), items.map { it.body })
        // 내 비공개 제보의 작가 답변은 비공개여도 제보자인 내게 보인다.
        assertEquals(listOf("비공개 답변"), items.first { it.id == "a" }.responses.map { it.body })
        assertEquals(emptyList<ReportResponse>(), service.mine("nobody").items)
    }

    @Test fun `inbox lists reports of the works I own newest first and skips deleted works`() {
        work("w1", owner = "me"); work("w2", owner = "me"); work("gone", owner = "me", deleted = true); work("theirs", owner = "other")
        report("a", work = "w1", at = t0.plusSeconds(1), visibility = "private"); report("b", work = "w2", at = t0.plusSeconds(2))
        report("c", work = "gone", at = t0.plusSeconds(3)); report("d", work = "theirs", at = t0.plusSeconds(4))
        report("e", reporter = "me", work = "w1", at = t0.plusSeconds(5))

        val items = service.inbox("me").items

        assertEquals(listOf("e", "b", "a"), items.map { it.id })
        assertEquals(listOf("w1 제목", "w2 제목", "w1 제목"), items.map { it.workTitle })
        assertTrue(items.all { it.owner })
        assertEquals(listOf(true, false, false), items.map { it.mine })
        // 소유자는 비공개 제보의 원문도 본다.
        assertEquals("본문", items.first { it.id == "a" }.body)
    }

    @Test fun `an owner with no works gets an empty inbox without querying reports`() {
        work("theirs", owner = "other")
        report("d", work = "theirs")

        assertEquals(emptyList<ReportResponse>(), service.inbox("me").items)
        verify(reports, never()).findTop200ByWorkIdInOrderByCreatedAtDesc(ArgumentMatchers.anyCollection<String>())
    }

    @Test fun `inbox with a work id lists only that work and the filter applies before the 200 cap`() {
        work("w1", owner = "me"); work("w2", owner = "me")
        report("old", work = "w2", at = t0)
        repeat(201) { report("n$it", work = "w1", at = t0.plusSeconds(10L + it)) }

        // 필터가 200개 상한보다 늦으면 w1의 새 제보 200개에 밀려 w2의 제보가 사라진다.
        assertEquals(listOf("old"), service.inbox("me", "w2").items.map { it.id })
        assertEquals(200, service.inbox("me", "w1").items.size)
        assertFalse(service.inbox("me").items.any { it.id == "old" })
    }

    @Test fun `inbox with a work id that is not mine is an empty list that reads neither reports nor Core`() {
        work("mine", owner = "me"); work("theirs", owner = "other"); work("gone", owner = "me", deleted = true)
        report("a", work = "mine"); report("b", work = "theirs"); report("c", work = "gone")

        // 남의 작품·삭제한 작품·없는 작품·형식이 틀린 값은 존재 여부를 드러내지 않도록 모두 같은 빈 목록이다.
        for (id in listOf("theirs", "gone", "no-such-work", "not-a-uuid")) assertEquals(emptyList<ReportResponse>(), service.inbox("me", id).items, id)
        verify(reports, never()).findTop200ByWorkIdInOrderByCreatedAtDesc(ArgumentMatchers.anyCollection<String>())
        assertTrue(asked.isEmpty())
    }

    @Test fun `inbox with a blank work id is the same as no filter`() {
        work("w1", owner = "me"); work("w2", owner = "me")
        report("a", work = "w1", at = t0.plusSeconds(1)); report("b", work = "w2", at = t0.plusSeconds(2))

        // 화면이 "전체 작품"을 빈 값(`workId=`)으로 보내도 인박스가 비어 보이지 않는다.
        for (blank in listOf("", "  ")) assertEquals(listOf("b", "a"), service.inbox("me", blank).items.map { it.id }, "[$blank]")
    }

    @Test fun `the reporter changes visibility at any time even after withdrawal`() {
        work(); val row = report("r1", reporter = "reporter", visibility = "private")

        val shown = service.setVisibility("work", "r1", "reporter", VisibilityRequest("public"))
        assertEquals("public", shown.visibility)
        assertEquals("public", row.visibility)
        assertTrue(row.updatedAt > t0)

        service.withdraw("work", "r1", "reporter")
        assertEquals("private", service.setVisibility("work", "r1", "reporter", VisibilityRequest("private")).visibility)
    }

    @Test fun `a correction adds a record and keeps the original text and withdrawal blocks further corrections`() {
        work(); val row = report("r1", reporter = "reporter", body = "처음 본문", quote = "인용")

        service.correct("work", "r1", "reporter", CorrectionRequest("  첫 정정  "))
        val shown = service.correct("work", "r1", "reporter", CorrectionRequest("둘째 정정"))

        assertEquals(listOf("correct" to "첫 정정", "correct" to "둘째 정정"), amendmentRows.map { it.action to it.body })
        assertEquals(listOf("처음 본문", "인용", "unchecked"), listOf(row.body, row.quote, row.status))
        assertEquals(listOf("첫 정정", "둘째 정정"), shown.amendments.map { it.body })
        assertEquals("처음 본문", shown.body)
        assertTrue(row.updatedAt > t0)

        service.withdraw("work", "r1", "reporter")
        assertEquals(409, failure { service.correct("work", "r1", "reporter", CorrectionRequest("늦은 정정")) }.status)
        assertEquals(2, amendmentRows.count { it.action == "correct" })
    }

    @Test fun `withdrawal is recorded once keeps text and status and shows withdrawn`() {
        work(); val row = report("r1", reporter = "reporter", status = "answered", body = "원문")

        val shown = service.withdraw("work", "r1", "reporter")

        assertNotNull(row.withdrawnAt)
        assertEquals(listOf("answered", "원문"), listOf(row.status, row.body))
        assertEquals(listOf("withdraw" to null), amendmentRows.map { it.action to it.body })
        assertEquals(listOf(true, "원문", "answered"), listOf(shown.withdrawn, shown.body, shown.status))
        assertEquals(listOf("withdraw"), shown.amendments.map { it.action })
        val withdrawnAt = row.withdrawnAt
        assertEquals(409, failure { service.withdraw("work", "r1", "reporter") }.status)
        assertEquals(withdrawnAt, row.withdrawnAt)
        assertEquals(1, amendmentRows.size)
        // 철회해도 행은 남고 작가는 철회됨을 본다.
        assertTrue(service.inbox("author").items.single().withdrawn)
    }

    @Test fun `author check records once moves unchecked to checked and is idempotent`() {
        work(); val row = report("r1", status = "unchecked")

        val first = service.check("work", "r1", "author")

        assertEquals(listOf("checked", true), listOf(row.status, first.authorChecked))
        val checkedAt = row.authorCheckedAt
        assertNotNull(checkedAt)
        val updatedAt = row.updatedAt
        assertEquals(listOf("checked", true), service.check("work", "r1", "author").let { listOf(it.status, it.authorChecked) })
        assertEquals(listOf(checkedAt, updatedAt), listOf(row.authorCheckedAt, row.updatedAt))
        // 이미 답변·완료·종료인 제보는 확인 기록만 남기고 상태는 그대로다.
        for (status in listOf("answered", "resolved", "closed")) {
            val other = report("s-$status", status = status)
            service.check("work", other.id, "author")
            assertEquals(listOf(status, true), listOf(other.status, other.authorCheckedAt != null))
        }
    }

    @Test fun `an answer or a status change records the author check once even without a prior check`() {
        work()
        val answeredRow = report("r1", status = "unchecked"); val changedRow = report("r2", status = "unchecked")
        val earlier = report("r3", status = "checked").also { it.authorCheckedAt = t0.plusSeconds(5) }

        val answered = service.answer("work", "r1", "author", ResponseRequest("답변"))
        val changed = service.setStatus("work", "r2", "author", StatusRequest("resolved"))
        service.answer("work", "r3", "author", ResponseRequest("뒤늦은 답변"))
        service.setStatus("work", "r3", "author", StatusRequest("closed"))

        // 확인 없이 처리해도 작가는 제보를 본 것이라 '확인했어요'가 남지 않는다. 처음 기록한 시각은 바뀌지 않는다.
        assertEquals(listOf(true, true), listOf(answered.authorChecked, changed.authorChecked))
        assertEquals(listOf(answeredRow.updatedAt, changedRow.updatedAt), listOf(answeredRow.authorCheckedAt, changedRow.authorCheckedAt))
        assertEquals(t0.plusSeconds(5), earlier.authorCheckedAt)
    }

    @Test fun `the reporter's own changes never record an author check`() {
        work(); val row = report("r1", reporter = "reporter")

        service.setVisibility("work", "r1", "reporter", VisibilityRequest("public"))
        service.correct("work", "r1", "reporter", CorrectionRequest("정정"))
        service.withdraw("work", "r1", "reporter")

        assertNull(row.authorCheckedAt)
    }

    @Test fun `an answer is stored with its public flag and moves unchecked or checked to answered`() {
        work()
        val fresh = report("r1", status = "unchecked"); val seen = report("r2", status = "checked"); val done = report("r3", status = "resolved")

        val shown = service.answer("work", "r1", "author", ResponseRequest("  답변이에요  ", true))
        service.answer("work", "r2", "author", ResponseRequest("비공개 답변"))
        service.answer("work", "r3", "author", ResponseRequest("뒤늦은 답변"))

        assertEquals(listOf("answered", "answered", "resolved"), listOf(fresh.status, seen.status, done.status))
        assertEquals(listOf(Triple("r1", "author", "답변이에요"), Triple("r2", "author", "비공개 답변"), Triple("r3", "author", "뒤늦은 답변")), replyRows.map { Triple(it.reportId, it.authorId, it.body) })
        assertEquals(listOf(true, false, false), replyRows.map { it.isPublic })
        assertEquals(replyRows[0].id, UUID.fromString(replyRows[0].id).toString())
        assertEquals(listOf("답변이에요"), shown.responses.map { it.body })
        assertEquals("author-닉", shown.responses.single().authorName)
        assertEquals("answered", shown.status)
        assertTrue(fresh.updatedAt > t0)
    }

    @Test fun `the author can set any finished or progress status but not unchecked`() {
        work(); val row = report("r1")

        for (status in listOf("checked", "answered", "resolved", "closed", "checked")) {
            assertEquals(status, service.setStatus("work", "r1", "author", StatusRequest(status)).status)
            assertEquals(status, row.status)
        }
        assertEquals(422, failure { service.setStatus("work", "r1", "author", StatusRequest("unchecked")) }.status)
        assertEquals("checked", row.status)
    }

    private val reporterOps: List<Pair<String, (String) -> Any?>> = listOf(
        "visibility" to { who -> service.setVisibility("work", "r1", who, VisibilityRequest("public")) },
        "correction" to { who -> service.correct("work", "r1", who, CorrectionRequest("정정")) },
        "withdrawal" to { who -> service.withdraw("work", "r1", who) },
    )
    private val ownerOps: List<Pair<String, (String) -> Any?>> = listOf(
        "check" to { who -> service.check("work", "r1", who) },
        "answer" to { who -> service.answer("work", "r1", who, ResponseRequest("답변")) },
        "status" to { who -> service.setStatus("work", "r1", who, StatusRequest("closed")) },
    )

    @Test fun `on a public report strangers get 403 and the reporter and owner each only do their own writes`() {
        work()
        report("r1", reporter = "reporter", visibility = "public")

        for ((name, op) in reporterOps + ownerOps) assertEquals(403, failure { op("stranger") }.status, name)
        for ((name, op) in reporterOps) assertEquals(403, failure { op("author") }.status, "owner $name")
        for ((name, op) in ownerOps) assertEquals(403, failure { op("reporter") }.status, "reporter $name")
        assertTrue(amendmentRows.isEmpty() && replyRows.isEmpty())
        assertEquals(listOf("unchecked", "public"), rows.single().let { listOf(it.status, it.visibility) })
        for ((name, op) in reporterOps) assertNotNull(op("reporter"), name)
        for ((name, op) in ownerOps) assertNotNull(op("author"), name)
    }

    @Test fun `on a private report a stranger who cannot see it gets 404 while someone who can see it gets 403`() {
        work()
        report("r1", reporter = "reporter", visibility = "private")

        for ((name, op) in reporterOps + ownerOps) assertEquals(404, failure { op("stranger") }.status, name)
        for ((name, op) in reporterOps) assertEquals(403, failure { op("author") }.status, "owner $name")
        for ((name, op) in ownerOps) assertEquals(403, failure { op("reporter") }.status, "reporter $name")

        // 공개 답변이 있으면 원문 없이라도 보이므로 낯선 사람의 쓰기는 404가 아니라 403이다.
        reply("r1", isPublic = true)
        for ((name, op) in reporterOps + ownerOps) assertEquals(403, failure { op("stranger") }.status, name)
    }

    @Test fun `a report is 404 through another work and a deleted or unknown work`() {
        work(); work("other"); work("gone", deleted = true)
        report("r1", reporter = "reporter"); report("r2", reporter = "reporter", work = "gone")

        assertEquals(404, failure { service.withdraw("other", "r1", "reporter") }.status)
        assertEquals(404, failure { service.check("other", "r1", "author") }.status)
        assertEquals(404, failure { service.withdraw("unknown", "r1", "reporter") }.status)
        assertEquals(404, failure { service.withdraw("gone", "r2", "reporter") }.status)
        assertEquals(404, failure { service.check("work", "missing", "author") }.status)
        assertNull(rows.first { it.id == "r1" }.withdrawnAt)
    }

    @Test fun `every write locks the report row it changes`() {
        work(); report("r1", reporter = "reporter")

        for ((_, op) in reporterOps) op("reporter")
        for ((_, op) in ownerOps) op("author")

        verify(reports, times(6)).lockByIdAndWorkId("r1", "work")
    }
}
