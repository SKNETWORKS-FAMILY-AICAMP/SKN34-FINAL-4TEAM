package ai.storyfork.content.editsuggestion

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.episodeVersionId
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.editsuggestion.domain.EditSuggestionRules
import ai.storyfork.content.editsuggestion.entity.EditSuggestionEntity
import ai.storyfork.content.editsuggestion.repository.EditSuggestionRepository
import ai.storyfork.content.editsuggestion.service.EditSuggestionService
import ai.storyfork.content.editsuggestion.service.dto.*
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/**
 * 수정 제안 규칙을 DB 없이 검증한다. 저장소·작품 접근·회차·Core 닉네임은 메모리 대역이다.
 * 승인 반영의 트랜잭션 경계는 [RecordingManager]가 begin/commit/rollback 순서를 기록해 확인하고,
 * 실제 SQL·Security·HTTP는 CI의 EditSuggestionIntegrationTest가 확인한다.
 */
class EditSuggestionServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val works = mock(WorkRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val suggestions = mock(EditSuggestionRepository::class.java)
    private val episodes = mock(EpisodeService::class.java)
    private val episodeVersions = mock(EpisodeVersionService::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    // begin·commit·rollback을 순서대로 기록한다. 괄호 안은 그 시점의 제안 상태다.
    private val events = mutableListOf<String>()
    private val service = EditSuggestionService(access, works, current, versions, suggestions, episodes, episodeVersions, nicknames,
        TransactionTemplate(RecordingManager()))

    private inner class RecordingManager : PlatformTransactionManager {
        override fun getTransaction(definition: TransactionDefinition?): TransactionStatus { events += "begin"; return SimpleTransactionStatus() }
        override fun commit(status: TransactionStatus) { events += "commit(${rows.firstOrNull()?.status})" }
        override fun rollback(status: TransactionStatus) { events += "rollback(${rows.firstOrNull()?.status})" }
    }

    private val body = "그는 문을 열었다. 않 된다고 말했다. 그리고 떠났다."
    private val nbsp = "${Char(0xA0)}${Char(0xA0)}"
    private val t0 = Instant.parse("2020-01-01T00:00:00Z")
    private val rows = mutableListOf<EditSuggestionEntity>()
    private val workRows = mutableMapOf<String, WorkEntity>()
    private val hidden = mutableSetOf<String>()
    private val deleted = mutableSetOf<String>()
    private val withdrawn = mutableSetOf<String>()
    // Fork 작품 → 원작이 삭제됐는지, 그리고 분기 전에 상속한 발행 회차
    private val forks = mutableMapOf<String, Boolean>()
    private val inheritedEpisodes = mutableSetOf<Pair<String, Int>>()
    private val asked = mutableListOf<List<String>>()
    // (작품, 회차) → 현재 발행 버전 ID와 발행 버전 본문
    private val publishedVersion = mutableMapOf<Pair<String, Int>, String>()
    private val versionBody = mutableMapOf<String, String>()
    // 집필 중인 초안과 저장 버전(contentVersionId). inherited면 원작 기준 회차다.
    private var draftBody = body
    private var draftRevision = 4
    private var inherited = false
    private val savedVersions = mutableListOf("cv-0")
    private val saveRequests = mutableListOf<DraftRequest>()
    private var saveFailure: Throwable? = null
    private var beforeSaveFails: (() -> Unit)? = null

    private fun anyRow() = ArgumentMatchers.any(EditSuggestionEntity::class.java) ?: EditSuggestionEntity()
    private fun anyDraft() = ArgumentMatchers.any(DraftRequest::class.java) ?: DraftRequest("t", "b", 0)

    private fun accessOf(id: String): WorkAccessResult {
        val work = workRows[id] ?: throw ContentFailure(404, "작품을 찾을 수 없어요.")
        val source = forks[id]?.let { SourceResponse("origin", "원작", 2, 1, "all", deleted = it) }
        return WorkAccessResult(work.id, work.ownerId, work.title, "", 0, "world", if (id in hidden) "private" else "public", false, false, source, false, id in deleted || work.deletedAt != null)
    }

    init {
        workRows["work"] = WorkEntity(id = "work", ownerId = "owner", title = "별빛 서약", createdAt = t0)
        publishedVersion["work" to 1] = "version-1"
        versionBody["version-1"] = body
        `when`(access.get(ArgumentMatchers.anyString())).thenAnswer { accessOf(it.arguments[0] as String) }
        `when`(access.published(ArgumentMatchers.anyString())).thenAnswer { call ->
            accessOf(call.arguments[0] as String).also { if (!it.publiclyVisible()) throw ContentFailure(404, "공개 작품을 찾을 수 없어요.") }
        }
        `when`(access.own(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            accessOf(call.arguments[0] as String).also { if (it.ownerId != call.arguments[1] || it.deleted) throw ContentFailure(404, "작품을 찾을 수 없어요.") }
        }
        `when`(works.findAllById(ArgumentMatchers.anyIterable<String>())).thenAnswer { call ->
            val ids = (call.arguments[0] as Iterable<*>).toSet()
            workRows.values.filter { it.id in ids }
        }
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            workRows.values.filter { it.ownerId == call.arguments[0] }.sortedByDescending { it.createdAt }
        }
        `when`(current.findByWorkIdAndSequence(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())).thenAnswer { call ->
            val work = call.arguments[0] as String
            val number = call.arguments[1] as Int
            if (work to number in publishedVersion) EpisodeCurrentEntity("episode-$number", work, number, publishedVersion[work to number], work to number in inheritedEpisodes) else null
        }
        `when`(versions.findById(ArgumentMatchers.anyString())).thenAnswer { call ->
            val id = call.arguments[0] as String
            Optional.ofNullable(versionBody[id]?.let { EpisodeVersionEntity(id = id, content = it) })
        }
        `when`(suggestions.save(anyRow())).thenAnswer { call -> (call.arguments[0] as EditSuggestionEntity).also { if (it !in rows) rows.add(it) } }
        `when`(suggestions.findByIdAndWorkId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            rows.firstOrNull { it.id == call.arguments[0] && it.workId == call.arguments[1] }
        }
        `when`(suggestions.findTop200ByProposerIdOrderByCreatedAtDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            rows.filter { it.proposerId == call.arguments[0] }.sortedByDescending { it.createdAt }
        }
        `when`(suggestions.findTop200ByWorkIdInOrderByCreatedAtDesc(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            val ids = call.arguments[0] as Collection<*>
            rows.filter { it.workId in ids }.sortedByDescending { it.createdAt }.take(200)
        }
        `when`(episodes.read(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())).thenAnswer { call ->
            episodeOf(call.arguments[2] as Int)
        }
        `when`(episodeVersions.save(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), anyDraft())).thenAnswer { call ->
            val request = call.arguments[3] as DraftRequest
            saveRequests += request
            beforeSaveFails?.invoke()
            saveFailure?.let { throw it }
            draftBody = request.body
            draftRevision = request.revision + 1
            savedVersions += "cv-${savedVersions.size}"
            episodeOf(call.arguments[2] as Int)
        }
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            val ids = (call.arguments[0] as Collection<*>).map { it as String }
            asked += ids
            ids.filter { it !in withdrawn }.associateWith { "$it-닉" }
        }
    }

    private fun episodeOf(number: Int) = EpisodeResponse(number, DraftResponse("1화", draftBody, draftRevision, "작가의 말"),
        savedVersions.map { VersionResponse(it, "1화", "본문", 0, number, t0.toString()) }, "cv-published", inherited, null)

    private fun row(id: String = "s1", proposer: String = "reader", before: String = "않 된다고", after: String = "안 된다고", status: String = "pending", at: Instant = t0,
        work: String = "work", number: Int = 1, version: String = "version-1", edited: String? = null, applyResult: String? = null) =
        EditSuggestionEntity(id = id, workId = work, episodeNumber = number, publishedVersionId = version, proposerId = proposer, beforeText = before, afterText = after,
            editedText = edited, status = status, applyResult = applyResult, createdAt = at, updatedAt = at).also { rows.add(it) }

    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)
    private fun request(before: String = "않 된다고", after: String = "안 된다고", reason: String? = null) = CreateSuggestionRequest(before, after, reason)

    // ───── 등록 ─────

    @Test fun `create pins the published version and stores trimmed text as a reader proposal`() {
        publishedVersion["work" to 2] = "version-2"
        versionBody["version-2"] = "둘째 회차. 않 된다고 말했다."

        val created = service.create("work", 2, "reader", request("  않 된다고  ", "  안 된다고 ", " 맞춤법 "))

        val saved = rows.single()
        assertEquals(listOf<Any?>("work", 2, "version-2", "reader", "reader", null, "않 된다고", "안 된다고", null, "맞춤법", "pending"),
            listOf(saved.workId, saved.episodeNumber, saved.publishedVersionId, saved.proposerId, saved.source, saved.reportId, saved.beforeText, saved.afterText, saved.editedText, saved.reason, saved.status))
        assertEquals(listOf<Any?>(null, null, null, null, null), listOf(saved.decisionReason, saved.applyResult, saved.applyFailure, saved.appliedVersionId, saved.decidedAt))
        assertEquals(saved.id, UUID.fromString(saved.id).toString())
        assertEquals(saved.createdAt, saved.updatedAt)
        assertEquals(listOf<Any?>(saved.id, "work", "별빛 서약", 2, "version-2", "reader", "reader-닉", true, false),
            listOf(created.id, created.workId, created.workTitle, created.episodeNumber, created.publishedVersionId, created.source, created.proposerName, created.mine, created.owner))
        assertEquals(listOf<Any?>("pending", null, null, null), listOf(created.status, created.applyResult, created.applyFailure, created.appliedVersionId))
        verify(access).published("work")
    }

    @Test fun `a blank reason is stored as null and the work owner may propose to their own work`() {
        val created = service.create("work", 1, "owner", request(reason = "   "))

        assertNull(rows.single().reason)
        assertEquals(listOf(true, true), listOf(created.mine, created.owner))
    }

    @Test fun `the 500 character limit applies after trimming`() {
        val sentence = "가".repeat(500)
        versionBody["version-1"] = "앞 $sentence 뒤"

        service.create("work", 1, "reader", request("  $sentence  ", "나${"가".repeat(499)}", "가".repeat(500)))

        assertEquals(listOf(sentence, "나${"가".repeat(499)}", "가".repeat(500)), rows.single().let { listOf(it.beforeText, it.afterText, it.reason) })
    }

    @Test fun `invalid input is 422 before any access check and nothing is stored`() {
        val tooLong = "가".repeat(501)
        val invalid = listOf(
            request("", "안 된다고"), request("   ", "안 된다고"), request("않 된다고", ""), request("않 된다고", "  "),
            request(tooLong, "안 된다고"), request("않 된다고", tooLong), request("않 된다고", "안 된다고", tooLong),
            // PostgreSQL text는 U+0000을 저장하지 못한다. NBSP만인 값은 Bean Validation이 아니라 Kotlin isNotBlank로 거절한다.
            request("않\u0000", "안 된다고"), request("않 된다고", "안\u0000"), request("않 된다고", "안 된다고", "사유\u0000"), request(nbsp, "안 된다고"), request("않 된다고", nbsp),
            // 같은 문장은 고친 게 아니다(앞뒤 공백을 지운 뒤 비교).
            request("않 된다고", "않 된다고"), request("않 된다고", "  않 된다고  "),
        )

        for (data in invalid) assertEquals(422, failure { service.create("hidden-work", 1, "reader", data) }.status, data.toString())

        assertTrue(rows.isEmpty())
        verifyNoInteractions(access)
    }

    @Test fun `a sentence the pinned published text does not contain is 422 with the contract message`() {
        val error = failure { service.create("work", 1, "reader", request("본문에 없는 문장", "고친 문장")) }

        assertEquals(422, error.status)
        assertEquals("원문에서 고칠 문장을 찾을 수 없어요.", error.message)
        assertTrue(rows.isEmpty())
    }

    @Test fun `the sentence is checked against the published text and not the newer draft`() {
        draftBody = "초안에만 있는 새 문장. 않 된다고"

        assertEquals(422, failure { service.create("work", 1, "reader", request("초안에만 있는 새 문장.", "고친 문장.")) }.status)
        service.create("work", 1, "reader", request())

        assertEquals(1, rows.size)
    }

    @Test fun `a sentence that appears several times in the published text is accepted`() {
        versionBody["version-1"] = "않 된다고. 않 된다고."

        service.create("work", 1, "reader", request())

        assertEquals(1, rows.size)
    }

    @Test fun `private or restricted works and unpublished or missing episodes are 404 and nothing is stored`() {
        hidden += "work"
        assertEquals(404, failure { service.create("work", 1, "reader", request()) }.status)
        hidden.clear()
        publishedVersion.clear()
        assertEquals(404, failure { service.create("work", 1, "reader", request()) }.status)
        publishedVersion["work" to 1] = "version-1"
        assertEquals(404, failure { service.create("unknown", 1, "reader", request()) }.status)

        assertTrue(rows.isEmpty())
    }

    @Test fun `an episode whose current version is gone is 404`() {
        `when`(current.findByWorkIdAndSequence("work", 3)).thenReturn(EpisodeCurrentEntity("episode-3", "work", 3, null))

        assertEquals("공개 회차를 찾을 수 없어요.", failure { service.create("work", 3, "reader", request()) }.message)
    }

    @Test fun `an inherited episode of a fork whose original was deleted is 404 whether or not the hidden text holds the sentence`() {
        // 독자에게는 이 회차의 본문이 가려진다(WorkAccessResult.readerEpisodes). 문장이 있느냐에 따라 201/422가 갈리면 숨긴 본문이 새어 나간다.
        forks["work"] = true
        inheritedEpisodes += "work" to 1

        val found = failure { service.create("work", 1, "reader", request()) }
        val missing = failure { service.create("work", 1, "reader", request("본문에 없는 문장", "고친 문장")) }

        assertEquals(404, found.status)
        assertEquals("공개 회차를 찾을 수 없어요.", found.message)
        assertEquals(found.status, missing.status)
        assertEquals(found.message, missing.message)
        verify(versions, never()).findById(ArgumentMatchers.anyString())
        assertTrue(rows.isEmpty())
    }

    @Test fun `the fork's own episodes and inherited episodes of a live original still accept suggestions`() {
        forks["work"] = true
        service.create("work", 1, "reader", request())
        forks["work"] = false
        inheritedEpisodes += "work" to 1
        service.create("work", 1, "reader", request())

        assertEquals(2, rows.size)
    }

    // ───── 열람 ─────

    @Test fun `only the proposer and the work owner can read a suggestion and everyone else gets 404`() {
        row()

        val asProposer = service.read("work", "s1", "reader")
        val asOwner = service.read("work", "s1", "owner")

        assertEquals(listOf(true, false), listOf(asProposer.mine, asProposer.owner))
        assertEquals(listOf(false, true), listOf(asOwner.mine, asOwner.owner))
        assertEquals(404, failure { service.read("work", "s1", "stranger") }.status)
        assertEquals(404, failure { service.read("other-work", "s1", "owner") }.status)
        workRows["other-work"] = WorkEntity(id = "other-work", ownerId = "owner", title = "다른 작품")
        assertEquals(404, failure { service.read("other-work", "s1", "owner") }.status)
        assertEquals(404, failure { service.read("work", "missing", "owner") }.status)
    }

    @Test fun `the list of my suggestions is newest first and only mine`() {
        row("old", at = t0)
        row("new", at = t0.plusSeconds(10))
        row("theirs", proposer = "other", at = t0.plusSeconds(20))

        val items = service.mine("reader").items

        assertEquals(listOf("new", "old"), items.map { it.id })
        assertTrue(items.all { it.mine && !it.owner })
        assertEquals(emptyList<String>(), service.mine("nobody").items.map { it.id })
    }

    @Test fun `the inbox lists suggestions on my own works only and newest first`() {
        workRows["second"] = WorkEntity(id = "second", ownerId = "owner", title = "두 번째 작품", createdAt = t0.plusSeconds(1))
        workRows["theirs"] = WorkEntity(id = "theirs", ownerId = "other", title = "남의 작품")
        workRows["gone"] = WorkEntity(id = "gone", ownerId = "owner", title = "삭제된 작품", deletedAt = t0)
        row("a", at = t0)
        row("b", work = "second", at = t0.plusSeconds(5))
        row("c", work = "theirs", at = t0.plusSeconds(6))
        row("d", work = "gone", at = t0.plusSeconds(7))

        val items = service.inbox("owner").items

        assertEquals(listOf("b", "a"), items.map { it.id })
        assertEquals(listOf("두 번째 작품", "별빛 서약"), items.map { it.workTitle })
        assertTrue(items.all { it.owner && !it.mine })
        assertEquals(emptyList<String>(), service.inbox("nobody").items.map { it.id })
    }

    @Test fun `the inbox with a work id lists only that work and the filter applies before the 200 cap`() {
        workRows["second"] = WorkEntity(id = "second", ownerId = "owner", title = "두 번째 작품", createdAt = t0.plusSeconds(1))
        row("old", work = "second", at = t0)
        repeat(201) { row("n$it", work = "work", at = t0.plusSeconds(10L + it)) }

        // 필터가 200개 상한보다 늦으면 첫 작품의 새 제안 200개에 밀려 두 번째 작품의 제안이 사라진다.
        assertEquals(listOf("old"), service.inbox("owner", "second").items.map { it.id })
        assertEquals(200, service.inbox("owner", "work").items.size)
        assertFalse(service.inbox("owner").items.any { it.id == "old" })
    }

    @Test fun `the inbox with a work id that is not mine is an empty list that reads neither suggestions nor Core`() {
        workRows["theirs"] = WorkEntity(id = "theirs", ownerId = "other", title = "남의 작품")
        workRows["gone"] = WorkEntity(id = "gone", ownerId = "owner", title = "삭제된 작품", deletedAt = t0)
        row("a"); row("b", work = "theirs"); row("c", work = "gone")

        // 남의 작품·삭제한 작품·없는 작품·형식이 틀린 값은 존재 여부를 드러내지 않도록 모두 같은 빈 목록이다.
        for (id in listOf("theirs", "gone", "no-such-work", "not-a-uuid")) assertEquals(emptyList<SuggestionResponse>(), service.inbox("owner", id).items, id)
        verify(suggestions, never()).findTop200ByWorkIdInOrderByCreatedAtDesc(ArgumentMatchers.anyCollection<String>())
        assertTrue(asked.isEmpty())
    }

    @Test fun `the inbox with a blank work id is the same as no filter`() {
        workRows["second"] = WorkEntity(id = "second", ownerId = "owner", title = "두 번째 작품", createdAt = t0.plusSeconds(1))
        row("a", at = t0)
        row("b", work = "second", at = t0.plusSeconds(5))

        // 화면이 "전체 작품"을 빈 값(`workId=`)으로 보내도 인박스가 비어 보이지 않는다.
        for (blank in listOf("", "  ")) assertEquals(listOf("b", "a"), service.inbox("owner", blank).items.map { it.id }, "[$blank]")
    }

    @Test fun `a list asks Core once for its distinct proposers and an empty list never asks`() {
        row("a", proposer = "p1", at = t0)
        row("b", proposer = "p2", at = t0.plusSeconds(1))
        row("c", proposer = "p1", at = t0.plusSeconds(2))

        service.inbox("owner")

        assertEquals(1, asked.size)
        assertEquals(setOf("p1", "p2"), asked.single().toSet())
        rows.clear(); asked.clear()
        assertEquals(emptyList<SuggestionResponse>(), service.inbox("owner").items)
        assertTrue(asked.isEmpty())
    }

    @Test fun `the proposer name follows Core and a member Core no longer knows is the withdrawn member`() {
        row(proposer = "gone")
        withdrawn += "gone"

        assertEquals("탈퇴한 회원", service.read("work", "s1", "owner").proposerName)
    }

    @Test fun `a Core failure fails the operation and is never replaced by a name`() {
        row()
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        val calls = listOf<Pair<String, () -> Any?>>(
            "read" to { service.read("work", "s1", "owner") },
            "mine" to { service.mine("reader") },
            "inbox" to { service.inbox("owner") },
            "create" to { service.create("work", 1, "reader", request()) },
            "edited" to { service.editedText("work", "s1", "owner", EditedTextRequest("안 된다고요")) },
            "hold" to { service.hold("work", "s1", "owner") },
        )
        for ((name, call) in calls) assertSame(failure, assertThrows(CoreAuthException::class.java) { call() }, name)
    }

    @Test fun `the response carries the scope check of the approved text`() {
        row()
        val auto = service.read("work", "s1", "owner")
        assertEquals(listOf("auto", listOf("단어마다 한 글자 오탈자 수준만 바뀌어요.")), listOf(auto.scope, auto.scopeReasons))

        rows.single().editedText = "전혀 다른 문장으로 바꿈"
        val review = service.read("work", "s1", "owner")
        assertEquals("review", review.scope)
        assertEquals("안 된다고", review.afterText)
        assertEquals("전혀 다른 문장으로 바꿈", review.editedText)
    }

    @Test fun `JSON field names follow the contract and a sparse request body falls back to defaults`() {
        val mapper = tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        row()

        val item = mapper.readTree(mapper.writeValueAsString(SuggestionListResponse(service.mine("reader").items))).path("items")[0]

        assertEquals(listOf("afterText", "appliedVersionId", "applyFailure", "applyResult", "beforeText", "createdAt", "decisionReason", "editedText", "episodeNumber", "id", "mine",
            "owner", "proposerName", "publishedVersionId", "reason", "scope", "scopeReasons", "source", "status", "updatedAt", "workId", "workTitle").sorted(),
            item.propertyNames().toList().sorted())
        assertTrue(item.path("editedText").isNull)
        assertEquals("2020-01-01T00:00:00Z", item.path("createdAt").asString())
        assertEquals(CreateSuggestionRequest("a", "b"), mapper.readValue("""{"beforeText":"a","afterText":"b"}""", CreateSuggestionRequest::class.java))
        assertEquals(CreateSuggestionRequest(), mapper.readValue("{}", CreateSuggestionRequest::class.java))
        assertEquals(EditedTextRequest("c"), mapper.readValue("""{"editedText":"c"}""", EditedTextRequest::class.java))
        assertEquals(RejectionRequest(), mapper.readValue("{}", RejectionRequest::class.java))
    }

    // ───── 편집안 저장 ─────

    @Test fun `the owner saves an edited text while the original after text is kept`() {
        val before = row()

        val saved = service.editedText("work", "s1", "owner", EditedTextRequest("  안 된다고요  "))

        assertEquals(listOf<Any?>("안 된다고요", "안 된다고", "pending"), listOf(before.editedText, before.afterText, before.status))
        assertTrue(before.updatedAt > t0)
        assertEquals(listOf<Any?>("안 된다고요", "안 된다고"), listOf(saved.editedText, saved.afterText))
    }

    @Test fun `an edited text identical to the sentence being replaced is 422 like the proposed text and keeps the stored one`() {
        val saved = row(edited = "기존 편집")

        for (text in listOf("않 된다고", "  않 된다고  ")) {
            val error = failure { service.editedText("work", "s1", "owner", EditedTextRequest(text)) }
            assertEquals(422, error.status, text)
            assertEquals("고친 문장이 원래 문장과 같아요.", error.message, text)
        }

        assertEquals("기존 편집", saved.editedText)
    }

    @Test fun `an edited text can be saved again and while held`() {
        val held = row(status = "held", edited = "처음 편집")

        service.editedText("work", "s1", "owner", EditedTextRequest("다시 편집"))

        assertEquals(listOf("다시 편집", "held"), listOf(held.editedText, held.status))
    }

    @Test fun `an edited text is not saved after the suggestion was decided`() {
        for ((status, result) in listOf("rejected" to null, "approved" to "applied", "approved" to "failed")) {
            rows.clear()
            val decided = row(status = status, applyResult = result)

            assertEquals(409, failure { service.editedText("work", "s1", "owner", EditedTextRequest("늦은 편집")) }.status, "$status $result")
            assertNull(decided.editedText)
        }
    }

    @Test fun `an invalid edited text is 422 before access checks and keeps the stored value`() {
        val saved = row(edited = "기존 편집")

        for (text in listOf("", "   ", "가".repeat(501), "편집\u0000", "  ")) {
            assertEquals(422, failure { service.editedText("work", "s1", "stranger", EditedTextRequest(text)) }.status, text.take(10))
        }

        assertEquals("기존 편집", saved.editedText)
        verifyNoInteractions(access)
    }

    @Test fun `owner only actions are 403 for the proposer and 404 for anyone who cannot see the suggestion`() {
        val saved = row()
        val actions = listOf<Pair<String, (String) -> Any?>>(
            "edited" to { who -> service.editedText("work", "s1", who, EditedTextRequest("편집")) },
            "approve" to { who -> service.approve("work", "s1", who) },
            "reject" to { who -> service.reject("work", "s1", who, RejectionRequest("사유")) },
            "hold" to { who -> service.hold("work", "s1", who) },
        )

        for ((name, action) in actions) {
            assertEquals(403, failure { action("reader") }.status, "$name proposer")
            assertEquals(404, failure { action("stranger") }.status, "$name stranger")
        }

        assertEquals(listOf<Any?>("pending", null, null), listOf(saved.status, saved.editedText, saved.decisionReason))
        assertTrue(saveRequests.isEmpty())
    }

    @Test fun `a deleted work hides its suggestions from detail owner actions and my list for everyone including the proposer`() {
        row()
        workRows.getValue("work").deletedAt = t0

        for (who in listOf("reader", "owner", "stranger")) assertEquals(404, failure { service.read("work", "s1", who) }.status, "read $who")
        // 제안자의 쓰기도 403이 아니라 404다(작품이 없는 것으로 통일).
        for (who in listOf("reader", "owner")) {
            assertEquals(404, failure { service.hold("work", "s1", who) }.status, "hold $who")
            assertEquals(404, failure { service.approve("work", "s1", who) }.status, "approve $who")
        }
        assertEquals(emptyList<String>(), service.mine("reader").items.map { it.id })
        assertEquals(emptyList<String>(), service.inbox("owner").items.map { it.id })
        assertTrue(asked.isEmpty())
    }

    @Test fun `my list keeps suggestions on live works and drops only the ones on deleted works`() {
        workRows["gone"] = WorkEntity(id = "gone", ownerId = "owner", title = "삭제된 작품", deletedAt = t0)
        row("kept", at = t0)
        row("dropped", work = "gone", at = t0.plusSeconds(1))

        assertEquals(listOf("kept"), service.mine("reader").items.map { it.id })
    }

    @Test fun `owner only actions are 404 for a missing suggestion a missing work and a deleted work`() {
        row()
        deleted += "work"

        assertEquals(404, failure { service.hold("work", "s1", "owner") }.status)
        deleted.clear()
        assertEquals(404, failure { service.hold("work", "missing", "owner") }.status)
        assertEquals(404, failure { service.hold("unknown", "s1", "owner") }.status)
        workRows["other"] = WorkEntity(id = "other", ownerId = "owner", title = "다른 작품")
        assertEquals(404, failure { service.hold("other", "s1", "owner") }.status)
    }

    // ───── 보류·거절 ─────

    @Test fun `hold moves a pending suggestion to held and repeating it or holding a decided one is 409`() {
        val saved = row()

        assertEquals("held", service.hold("work", "s1", "owner").status)
        assertEquals("held", saved.status)
        assertEquals(409, failure { service.hold("work", "s1", "owner") }.status)
        for ((status, result) in listOf("rejected" to null, "approved" to "applied", "approved" to "failed")) {
            saved.status = status
            saved.applyResult = result
            assertEquals(409, failure { service.hold("work", "s1", "owner") }.status, "$status $result")
            assertEquals(status, saved.status)
        }
        assertNull(saved.decidedAt)
    }

    @Test fun `reject closes a pending or held suggestion with an optional trimmed reason`() {
        val pending = row("p")
        val held = row("h", status = "held")
        val quiet = row("q")

        val rejected = service.reject("work", "p", "owner", RejectionRequest("  톤이 달라요  "))
        service.reject("work", "h", "owner", RejectionRequest("   "))
        service.reject("work", "q", "owner", null)

        assertEquals(listOf<Any?>("rejected", "톤이 달라요"), listOf(pending.status, pending.decisionReason))
        assertEquals(listOf<Any?>("rejected", "톤이 달라요"), listOf(rejected.status, rejected.decisionReason))
        assertNotNull(pending.decidedAt)
        assertEquals(listOf<Any?>("rejected", null), listOf(held.status, held.decisionReason))
        assertEquals(listOf<Any?>("rejected", null), listOf(quiet.status, quiet.decisionReason))
    }

    @Test fun `a decided suggestion cannot be rejected again or after approval and a long reason is 422`() {
        val saved = row()
        assertEquals(422, failure { service.reject("work", "s1", "owner", RejectionRequest("가".repeat(501))) }.status)
        assertEquals(422, failure { service.reject("work", "s1", "owner", RejectionRequest("사유\u0000")) }.status)
        assertEquals("pending", saved.status)

        service.reject("work", "s1", "owner", null)
        assertEquals(409, failure { service.reject("work", "s1", "owner", null) }.status)
        for ((status, result) in listOf("approved" to "applied", "approved" to "failed")) {
            saved.status = status
            saved.applyResult = result
            assertEquals(409, failure { service.reject("work", "s1", "owner", null) }.status, "$status $result")
        }
    }

    // ───── 승인·반영 ─────

    @Test fun `approval replaces the sentence in the current draft and saves a new draft version in one transaction`() {
        val saved = row()

        val approved = service.approve("work", "s1", "owner")

        // 초안의 현재 revision·제목·작가의 말로 기존 EpisodeVersionService.save를 한 번 부른다.
        assertEquals(listOf(DraftRequest("1화", "그는 문을 열었다. 안 된다고 말했다. 그리고 떠났다.", 4, "작가의 말")), saveRequests)
        assertEquals(listOf<Any?>("approved", "applied", null, episodeVersionId("work", 1, "cv-1")),
            listOf(saved.status, saved.applyResult, saved.applyFailure, saved.appliedVersionId))
        assertNotNull(saved.decidedAt)
        assertTrue(saved.updatedAt > t0)
        assertEquals(listOf<Any?>("approved", "applied", saved.appliedVersionId), listOf(approved.status, approved.applyResult, approved.appliedVersionId))
        // 저장과 상태 기록은 한 트랜잭션이라 성공하면 commit 한 번이다.
        assertEquals(listOf("begin", "commit(approved)"), events)
    }

    @Test fun `approval applies the edited text when the owner saved one`() {
        val saved = row(edited = "안 된다고요")

        service.approve("work", "s1", "owner")

        assertEquals("그는 문을 열었다. 안 된다고요 말했다. 그리고 떠났다.", saveRequests.single().body)
        assertEquals("안 된다고", saved.afterText)
    }

    @Test fun `approval of a held suggestion works`() {
        val saved = row(status = "held")

        service.approve("work", "s1", "owner")

        assertEquals(listOf("approved", "applied"), listOf(saved.status, saved.applyResult))
    }

    @Test fun `a changed base published version is 409 and nothing changes`() {
        val saved = row(version = "version-old")

        val error = failure { service.approve("work", "s1", "owner") }

        assertEquals(409, error.status)
        assertEquals("원문이 다시 발행돼 그대로 반영할 수 없어요. 집필실에서 직접 고치거나 거절해 주세요.", error.message)
        assertEquals(listOf<Any?>("pending", null, null), listOf(saved.status, saved.applyResult, saved.decidedAt))
        assertTrue(saveRequests.isEmpty())
        assertEquals(listOf("begin", "rollback(pending)"), events)
    }

    @Test fun `an episode that is no longer published counts as a changed base`() {
        row()
        publishedVersion.clear()

        assertEquals(409, failure { service.approve("work", "s1", "owner") }.status)
    }

    @Test fun `approval is 409 once decided and a successful apply is not applied twice`() {
        val saved = row()
        service.approve("work", "s1", "owner")
        saveRequests.clear()

        assertEquals(409, failure { service.approve("work", "s1", "owner") }.status)
        saved.status = "rejected"; saved.applyResult = null
        assertEquals(409, failure { service.approve("work", "s1", "owner") }.status)

        assertTrue(saveRequests.isEmpty())
    }

    @Test fun `a sentence missing from the draft is recorded as a failed apply and the draft is not saved`() {
        draftBody = "작가가 이미 고쳐 쓴 전혀 다른 본문."
        val saved = row()

        val approved = service.approve("work", "s1", "owner")

        assertEquals(listOf<Any?>("approved", "failed", EditSuggestionRules.NOT_FOUND_IN_DRAFT, null),
            listOf(saved.status, saved.applyResult, saved.applyFailure, saved.appliedVersionId))
        assertNotNull(saved.decidedAt)
        assertEquals(listOf<Any?>("approved", "failed", EditSuggestionRules.NOT_FOUND_IN_DRAFT), listOf(approved.status, approved.applyResult, approved.applyFailure))
        assertTrue(saveRequests.isEmpty())
        assertEquals(listOf("begin", "commit(approved)"), events)
    }

    @Test fun `a sentence found more than once in the draft is recorded as a failed apply`() {
        draftBody = "않 된다고. 그리고 않 된다고."
        val saved = row()

        service.approve("work", "s1", "owner")

        assertEquals(listOf("approved", "failed", EditSuggestionRules.AMBIGUOUS_IN_DRAFT), listOf(saved.status, saved.applyResult, saved.applyFailure))
        assertTrue(saveRequests.isEmpty())
    }

    @Test fun `an inherited source episode cannot be edited so the apply is recorded as failed`() {
        inherited = true
        val saved = row()

        service.approve("work", "s1", "owner")

        assertEquals(listOf("approved", "failed", "원작 기준 회차는 수정할 수 없어요."), listOf(saved.status, saved.applyResult, saved.applyFailure))
        assertTrue(saveRequests.isEmpty())
    }

    @Test fun `a failed save is rolled back and the failure is recorded in a separate transaction`() {
        saveFailure = ContentFailure(422, "제목은 120자, 원고는 40,000자 이내로 작성해 주세요.")
        val saved = row()

        val approved = service.approve("work", "s1", "owner")

        assertEquals(1, saveRequests.size)
        assertEquals(listOf<Any?>("approved", "failed", "제목은 120자, 원고는 40,000자 이내로 작성해 주세요.", null),
            listOf(saved.status, saved.applyResult, saved.applyFailure, saved.appliedVersionId))
        assertNotNull(saved.decidedAt)
        assertEquals(listOf("approved", "failed"), listOf(approved.status, approved.applyResult))
        // 반영 트랜잭션은 상태를 쓰기 전에 되돌려지고, 새 트랜잭션에서만 approved+failed가 커밋된다.
        assertEquals(listOf("begin", "rollback(pending)", "begin", "commit(approved)"), events)
    }

    @Test fun `an unexpected save error is recorded with a generic reason and not the internal message`() {
        saveFailure = IllegalStateException("jdbc: connection reset by peer")
        val saved = row()

        service.approve("work", "s1", "owner")

        assertEquals(listOf("approved", "failed", "초안을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."), listOf(saved.status, saved.applyResult, saved.applyFailure))
        assertEquals(listOf("begin", "rollback(pending)", "begin", "commit(approved)"), events)
    }

    @Test fun `a failure that cannot be recorded because the state changed meanwhile is 409 and keeps the new state`() {
        saveFailure = ContentFailure(409, "다른 편집이 저장됐어요.")
        val saved = row()
        // 반영이 실패한 직후, 실패를 기록하기 전에 다른 요청이 거절했다고 본다.
        beforeSaveFails = { saved.status = "rejected" }

        assertEquals(409, failure { service.approve("work", "s1", "owner") }.status)

        assertEquals(listOf<Any?>("rejected", null, null), listOf(saved.status, saved.applyResult, saved.applyFailure))
    }

    @Test fun `a failed apply can be retried and a success clears the failure`() {
        draftBody = "작가가 고쳐 쓴 본문."
        val saved = row()
        service.approve("work", "s1", "owner")
        assertEquals(listOf("approved", "failed"), listOf(saved.status, saved.applyResult))
        val decided = saved.decidedAt
        events.clear()

        draftBody = body
        val retried = service.approve("work", "s1", "owner")

        assertEquals(listOf<Any?>("approved", "applied", null, episodeVersionId("work", 1, "cv-1")),
            listOf(saved.status, saved.applyResult, saved.applyFailure, saved.appliedVersionId))
        assertEquals(decided, saved.decidedAt)
        assertEquals("applied", retried.applyResult)
        assertEquals(listOf("begin", "commit(approved)"), events)
    }

    @Test fun `a failed retry keeps the suggestion approved and failed`() {
        draftBody = "작가가 고쳐 쓴 본문."
        val saved = row(status = "approved", applyResult = "failed")
        saved.applyFailure = "예전 사유"

        service.approve("work", "s1", "owner")

        assertEquals(listOf("approved", "failed", EditSuggestionRules.NOT_FOUND_IN_DRAFT), listOf(saved.status, saved.applyResult, saved.applyFailure))
    }

    @Test fun `a Core failure while answering an approval rolls the whole approval back`() {
        row()
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        assertSame(failure, assertThrows(CoreAuthException::class.java) { service.approve("work", "s1", "owner") })

        // 응답을 만들지 못한 승인은 같은 트랜잭션에서 통째로 되돌려지고, 반영 실패로 오해해 기록하지도 않는다.
        assertEquals(listOf("begin", "rollback(approved)"), events)
    }
}
