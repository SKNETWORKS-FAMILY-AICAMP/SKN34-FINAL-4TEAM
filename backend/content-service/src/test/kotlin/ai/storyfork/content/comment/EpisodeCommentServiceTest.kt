package ai.storyfork.content.comment

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.comment.entity.EpisodeCommentEntity
import ai.storyfork.content.comment.entity.EpisodeCommentLikeEntity
import ai.storyfork.content.comment.repository.EpisodeCommentLikeRepository
import ai.storyfork.content.comment.repository.EpisodeCommentRepository
import ai.storyfork.content.comment.service.EpisodeCommentService
import ai.storyfork.content.comment.service.dto.CommentListResponse
import ai.storyfork.content.comment.service.dto.CommentResponse
import ai.storyfork.content.comment.service.dto.CreateCommentRequest
import ai.storyfork.content.comment.service.dto.UpdateCommentRequest
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.dao.DataIntegrityViolationException

/**
 * 회차 댓글 규칙을 DB 없이 검증한다. 저장소는 삭제 제외(deleted_at IS NULL)와 작품·회차 일치 조회를 흉내 내는 메모리 대역이고,
 * 작성자 표시명의 정본인 Core 닉네임 조회는 "<회원 id>-닉"을 돌려주는 대역이다([withdrawn]에 넣은 회원은 Core에 없다).
 * 실제 SQL·Security·HTTP는 CI의 EpisodeCommentPostgresTest가 확인한다.
 */
class EpisodeCommentServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val comments = mock(EpisodeCommentRepository::class.java)
    private val likes = mock(EpisodeCommentLikeRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = EpisodeCommentService(access, current, comments, likes, nicknames)
    private val rows = mutableListOf<EpisodeCommentEntity>()
    // Core에 없는(탈퇴한) 회원 id와, Core에 물은 id 묶음(호출마다 하나)이다.
    private val withdrawn = mutableSetOf<String>()
    private val asked = mutableListOf<List<String>>()
    private val likeRows = mutableListOf<EpisodeCommentLikeEntity>()
    // 수정 시각이 항상 이보다 늦도록 충분히 오래된 고정 시각이다.
    private val t0 = Instant.parse("2020-01-01T00:00:00Z")

    private fun anyComment() = ArgumentMatchers.any(EpisodeCommentEntity::class.java) ?: EpisodeCommentEntity()
    private fun anyLike() = ArgumentMatchers.any(EpisodeCommentLikeEntity::class.java) ?: EpisodeCommentLikeEntity()
    private fun anyKey() = ArgumentMatchers.any(EpisodeCommentLikeEntity.Key::class.java) ?: EpisodeCommentLikeEntity.Key()

    init {
        `when`(comments.save(anyComment())).thenAnswer { call -> (call.arguments[0] as EpisodeCommentEntity).also { rows.add(it) } }
        `when`(comments.findByIdAndWorkIdAndEpisodeNumberAndDeletedAtIsNull(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt()))
            .thenAnswer { call ->
                rows.firstOrNull { it.id == call.arguments[0] && it.workId == call.arguments[1] && it.episodeNumber == call.arguments[2] && it.deletedAt == null }
            }
        `when`(comments.findTop200ByWorkIdAndEpisodeNumberAndDeletedAtIsNullOrderByCreatedAtDesc(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt()))
            .thenAnswer { call ->
                rows.filter { it.workId == call.arguments[0] && it.episodeNumber == call.arguments[1] && it.deletedAt == null }.sortedByDescending { it.createdAt }.take(200)
            }
        `when`(likes.findAllByCommentIdIn(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            likeRows.filter { it.commentId in (call.arguments[0] as Collection<*>) }
        }
        `when`(likes.existsById(anyKey())).thenAnswer { call ->
            likeRows.any { EpisodeCommentLikeEntity.Key(it.commentId, it.memberId) == call.arguments[0] }
        }
        `when`(likes.saveAndFlush(anyLike())).thenAnswer { call -> (call.arguments[0] as EpisodeCommentLikeEntity).also { likeRows.add(it) } }
        doAnswer { call -> likeRows.removeAll { EpisodeCommentLikeEntity.Key(it.commentId, it.memberId) == call.arguments[0] }; null }.`when`(likes).deleteById(anyKey())
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            val ids = (call.arguments[0] as Collection<*>).map { it as String }
            asked += ids
            ids.filter { it !in withdrawn }.associateWith { "$it-닉" }
        }
    }

    private fun published(number: Int = 1, version: String? = "version-$number", work: String = "work") {
        `when`(current.findByWorkIdAndSequence(work, number)).thenReturn(EpisodeCurrentEntity("episode-$number", work, number, version))
    }
    private fun comment(id: String, author: String = "author", at: Instant = t0, body: String = "본문", spoiler: Boolean = false, quote: String? = null,
        version: String = "version-1", number: Int = 1, work: String = "work", hidden: Boolean = false) =
        EpisodeCommentEntity(id = id, workId = work, episodeNumber = number, publishedVersionId = version, authorId = author,
            body = body, quote = quote, spoiler = spoiler, createdAt = at, updatedAt = at, hidden = hidden).also { rows.add(it) }
    private fun like(comment: String, member: String) { likeRows.add(EpisodeCommentLikeEntity(comment, member)) }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    private val operations: List<Pair<String, () -> Any?>> = listOf(
        "list" to { service.list("work", 1, null, null) },
        "read" to { service.read("work", 1, "c1", null) },
        "create" to { service.create("work", 1, "reader", CreateCommentRequest("본문")) },
        "update" to { service.update("work", 1, "c1", "author", UpdateCommentRequest("본문")) },
        "delete" to { service.delete("work", 1, "c1", "author") },
        "like" to { service.like("work", 1, "c1", "reader") },
        "unlike" to { service.unlike("work", 1, "c1", "reader") },
    )

    @Test fun `JSON field names follow the contract and a sparse request body falls back to defaults`() {
        val mapper = tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()

        val response = CommentResponse("c1", "work", 3, "version-3", "닉네임", "본문", null, false, 2, true, false, false, true, t0, t0)
        val item = mapper.readTree(mapper.writeValueAsString(CommentListResponse(listOf(response)))).path("items")[0]

        assertEquals(listOf("authorName", "body", "createdAt", "edited", "episodeNumber", "hidden", "id", "liked", "likeCount", "mine", "publishedVersionId", "quote", "spoiler", "updatedAt", "workId").sorted(),
            item.propertyNames().toList().sorted())
        assertTrue(item.path("hidden").asBoolean())
        assertTrue(item.path("quote").isNull)
        assertEquals("2020-01-01T00:00:00Z", item.path("createdAt").asString())
        assertEquals(CreateCommentRequest("본문"), mapper.readValue("""{"body":"본문"}""", CreateCommentRequest::class.java))
        assertEquals(CreateCommentRequest(), mapper.readValue("{}", CreateCommentRequest::class.java))
        assertEquals(UpdateCommentRequest("본문", true), mapper.readValue("""{"body":"본문","spoiler":true}""", UpdateCommentRequest::class.java))
    }

    @Test fun `create pins the published version at write time and answers with the latest Core nickname`() {
        published(3, "version-3a")

        val created = service.create("work", 3, "reader", CreateCommentRequest("  좋았어요  ", " 인용 문장 ", true))

        val saved = rows.single()
        assertEquals(listOf<Any?>("work", 3, "version-3a", "reader", "좋았어요", "인용 문장", true),
            listOf(saved.workId, saved.episodeNumber, saved.publishedVersionId, saved.authorId, saved.body, saved.quote, saved.spoiler))
        assertEquals("reader-닉", created.authorName)
        assertEquals(listOf(listOf("reader")), asked)
        assertEquals(saved.id, UUID.fromString(saved.id).toString())
        assertNull(saved.deletedAt)
        assertEquals(saved.createdAt, saved.updatedAt)
        assertEquals(listOf<Any?>(saved.id, "version-3a", 3), listOf(created.id, created.publishedVersionId, created.episodeNumber))
        assertEquals(listOf<Any?>(0, false, true, false), listOf(created.likeCount, created.liked, created.mine, created.edited))
        verify(access).published("work")
    }

    @Test fun `each comment keeps the version published when it was written even after a newer one is published`() {
        published(1, "version-1")
        val first = service.create("work", 1, "reader", CreateCommentRequest("첫 댓글"))
        published(1, "version-2")
        val second = service.create("work", 1, "reader", CreateCommentRequest("둘째 댓글"))

        val shown = service.list("work", 1, null, null).items.associate { it.id to it.publishedVersionId }
        assertEquals(mapOf(first.id to "version-1", second.id to "version-2"), shown)
    }

    @Test fun `the author name follows the latest Core nickname and a member Core no longer knows is the withdrawn member`() {
        published()
        comment("c1", author = "author")
        comment("c2", author = "gone", at = t0.plusSeconds(1))
        withdrawn += "gone"

        val names = service.list("work", 1, null, null).items.associate { it.id to it.authorName }
        assertEquals(mapOf("c1" to "author-닉", "c2" to "탈퇴한 회원"), names)
        assertEquals("탈퇴한 회원", service.read("work", 1, "c2", null).authorName)
        // 쓰기 응답도 같다. 작성자 본인이 Core에서 사라졌어도 이름을 지어내지 않는다.
        assertEquals("탈퇴한 회원", service.create("work", 1, "gone", CreateCommentRequest("남긴 글")).authorName)
        assertEquals("탈퇴한 회원", service.update("work", 1, "c2", "gone", UpdateCommentRequest("고친 글")).authorName)
    }

    @Test fun `a list asks Core once for its distinct authors and an empty list never asks`() {
        published()
        comment("c1", author = "a"); comment("c2", author = "b", at = t0.plusSeconds(1)); comment("c3", author = "a", at = t0.plusSeconds(2))

        service.list("work", 1, "likes", "a")

        assertEquals(1, asked.size)
        assertEquals(setOf("a", "b"), asked.single().toSet())
        rows.clear(); asked.clear()
        assertEquals(emptyList<CommentResponse>(), service.list("work", 1, null, null).items)
        assertTrue(asked.isEmpty())
    }

    @Test fun `a Core failure fails the operation and is never replaced by a name`() {
        published()
        comment("c1", author = "author")
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        val calls = listOf<Pair<String, () -> Any?>>(
            "list" to { service.list("work", 1, null, null) },
            "read" to { service.read("work", 1, "c1", null) },
            "create" to { service.create("work", 1, "reader", CreateCommentRequest("본문")) },
            "update" to { service.update("work", 1, "c1", "author", UpdateCommentRequest("고침")) },
        )
        for ((name, call) in calls) assertSame(failure, assertThrows(CoreAuthException::class.java) { call() }, name)
    }

    @Test fun `an absent or blank quote is stored as null`() {
        published()

        for (quote in listOf(null, "", "   ")) service.create("work", 1, "reader", CreateCommentRequest("본문", quote))

        assertEquals(listOf(null, null, null), rows.map { it.quote })
    }

    @Test fun `the 500 character limit applies after trimming and the trimmed text is stored`() {
        published()
        val edge = "가".repeat(500)

        service.create("work", 1, "reader", CreateCommentRequest("  $edge  ", " $edge "))

        assertEquals(listOf(edge, edge), rows.single().let { listOf(it.body, it.quote) })
    }

    @Test fun `invalid input is 422 and nothing is stored`() {
        published()
        val tooLong = "가".repeat(501)
        val invalid = listOf(
            CreateCommentRequest(""), CreateCommentRequest("   "),
            // Bean Validation의 @NotBlank는 NBSP를 공백으로 보지 않으므로 Kotlin isNotBlank로 거절해야 한다.
            CreateCommentRequest("  "), CreateCommentRequest("  \t\n "),
            CreateCommentRequest(tooLong), CreateCommentRequest("  $tooLong  "),
            // PostgreSQL text는 U+0000을 저장하지 못하므로 저장 전에 거절한다.
            CreateCommentRequest("본문\u0000"), CreateCommentRequest("\u0000"), CreateCommentRequest(" \u0000 "),
            CreateCommentRequest("본문", "인용\u0000"), CreateCommentRequest("본문", "\u0000"), CreateCommentRequest("본문", tooLong),
        )

        for (data in invalid) assertEquals(422, failure { service.create("work", 1, "reader", data) }.status, data.toString())

        assertTrue(rows.isEmpty())
    }

    @Test fun `list is newest first by default and likes sort breaks ties by newest`() {
        published()
        comment("old", at = t0)
        comment("mid", at = t0.plusSeconds(10))
        comment("new", at = t0.plusSeconds(20))
        comment("quiet", at = t0.plusSeconds(30))
        like("old", "a"); like("old", "b"); like("mid", "a"); like("mid", "b"); like("new", "a")

        val latest = listOf("quiet", "new", "mid", "old")
        assertEquals(latest, service.list("work", 1, null, null).items.map { it.id })
        assertEquals(latest, service.list("work", 1, "latest", null).items.map { it.id })
        val byLikes = service.list("work", 1, "likes", null).items
        assertEquals(listOf("mid", "old", "new", "quiet"), byLikes.map { it.id })
        assertEquals(listOf(2, 2, 1, 0), byLikes.map { it.likeCount })
    }

    @Test fun `an unknown sort is 422`() {
        published()

        for (sort in listOf("popular", "LATEST", "")) assertEquals(422, failure { service.list("work", 1, sort, null) }.status, sort)
    }

    @Test fun `liked and mine follow the viewer and are false for anonymous`() {
        published()
        comment("mine", author = "reader", at = t0)
        comment("theirs", author = "other", at = t0.plusSeconds(1))
        like("theirs", "reader"); like("mine", "other")

        val asReader = service.list("work", 1, null, "reader").items.associateBy { it.id }
        assertEquals(listOf(true, false), listOf(asReader.getValue("mine").mine, asReader.getValue("theirs").mine))
        assertEquals(listOf(false, true), listOf(asReader.getValue("mine").liked, asReader.getValue("theirs").liked))
        val anonymous = service.list("work", 1, null, null).items
        assertTrue(anonymous.none { it.liked || it.mine })
        assertEquals(listOf(1, 1), anonymous.map { it.likeCount })
        assertEquals(listOf(false, false), service.read("work", 1, "theirs", null).let { listOf(it.liked, it.mine) })
    }

    @Test fun `detail shows the stored version and an edited flag only after an edit`() {
        published(1, "version-2")
        comment("c1", version = "version-1", quote = "인용")

        val before = service.read("work", 1, "c1", null)
        assertEquals(listOf<Any?>("version-1", "인용", false, "author-닉"), listOf(before.publishedVersionId, before.quote, before.edited, before.authorName))
        service.update("work", 1, "c1", "author", UpdateCommentRequest("고침"))
        assertTrue(service.read("work", 1, "c1", null).edited)
    }

    @Test fun `detail like and edit are 404 for another episode another work or an unknown comment`() {
        published(1); published(2); published(1, work = "other")
        comment("c1")

        for ((work, number, id) in listOf(Triple("work", 2, "c1"), Triple("other", 1, "c1"), Triple("work", 1, "missing"))) {
            assertEquals(404, failure { service.read(work, number, id, null) }.status, "read $work $number $id")
            assertEquals(404, failure { service.like(work, number, id, "fan") }.status, "like $work $number $id")
            assertEquals(404, failure { service.update(work, number, id, "author", UpdateCommentRequest("본문")) }.status, "update $work $number $id")
        }

        assertTrue(likeRows.isEmpty())
    }

    @Test fun `only the author edits body and spoiler while the quote and version stay`() {
        published()
        val row = comment("c1", body = "원래", spoiler = false, quote = "인용", version = "version-1")

        val updated = service.update("work", 1, "c1", "author", UpdateCommentRequest("  고친 글  ", true))

        assertEquals(listOf<Any?>("고친 글", true, "인용", "version-1", t0), listOf(row.body, row.spoiler, row.quote, row.publishedVersionId, row.createdAt))
        assertTrue(row.updatedAt > row.createdAt)
        assertEquals(listOf<Any?>("고친 글", true, "인용", true, true), listOf(updated.body, updated.spoiler, updated.quote, updated.edited, updated.mine))
    }

    @Test fun `anyone but the author including the work owner is 403 and the comment is untouched`() {
        `when`(access.published("work")).thenReturn(WorkAccessResult("work", "work-owner", "제목", "", 0, "world", "public", false, false, null))
        published()
        val row = comment("c1", author = "author", body = "원래", spoiler = true)

        for (member in listOf("work-owner", "other")) {
            assertEquals(403, failure { service.update("work", 1, "c1", member, UpdateCommentRequest("가로채기", false)) }.status, member)
            assertEquals(403, failure { service.delete("work", 1, "c1", member) }.status, member)
        }

        assertEquals(listOf<Any?>("원래", true, t0, null), listOf(row.body, row.spoiler, row.updatedAt, row.deletedAt))
    }

    @Test fun `an invalid edit keeps the existing values`() {
        published()
        val row = comment("c1", body = "원래", spoiler = true)

        for (body in listOf("", "   ", " ", "가".repeat(501), "본문\u0000")) {
            assertEquals(422, failure { service.update("work", 1, "c1", "author", UpdateCommentRequest(body, false)) }.status, body.take(10))
        }

        assertEquals(listOf<Any?>("원래", true, t0), listOf(row.body, row.spoiler, row.updatedAt))
    }

    @Test fun `delete is soft and removes the comment from list detail edit and like`() {
        published()
        val row = comment("c1")
        like("c1", "fan")

        service.delete("work", 1, "c1", "author")

        assertNotNull(row.deletedAt)
        verify(comments, never()).delete(anyComment())
        assertEquals(1, likeRows.size, "soft delete records deleted_at only")
        assertEquals(emptyList<String>(), service.list("work", 1, null, "author").items.map { it.id })
        val calls = listOf<Pair<String, () -> Any?>>(
            "read" to { service.read("work", 1, "c1", null) },
            "update" to { service.update("work", 1, "c1", "author", UpdateCommentRequest("본문")) },
            "delete" to { service.delete("work", 1, "c1", "author") },
            "like" to { service.like("work", 1, "c1", "fan2") },
            "unlike" to { service.unlike("work", 1, "c1", "fan") },
        )
        for ((name, call) in calls) assertEquals(404, failure { call() }.status, name)
        assertEquals(1, likeRows.size)
    }

    @Test fun `like and cancel are idempotent`() {
        published()
        comment("c1")

        repeat(2) { service.like("work", 1, "c1", "fan") }
        service.like("work", 1, "c1", "other-fan")
        assertEquals(2, likeRows.size)
        assertEquals(listOf<Any?>(2, true), service.read("work", 1, "c1", "fan").let { listOf(it.likeCount, it.liked) })

        repeat(2) { service.unlike("work", 1, "c1", "fan") }
        service.unlike("work", 1, "c1", "never-liked")
        assertEquals(listOf("other-fan"), likeRows.map { it.memberId })
        assertEquals(listOf<Any?>(1, false), service.read("work", 1, "c1", "fan").let { listOf(it.likeCount, it.liked) })
    }

    @Test fun `a concurrent duplicate like is ignored once the row exists`() {
        published()
        comment("c1")
        val racing = mock(EpisodeCommentLikeRepository::class.java)
        `when`(racing.existsById(anyKey())).thenReturn(false, true)
        `when`(racing.saveAndFlush(anyLike())).thenThrow(DataIntegrityViolationException("duplicate key"))

        assertDoesNotThrow { EpisodeCommentService(access, current, comments, racing, nicknames).like("work", 1, "c1", "fan") }

        verify(racing, times(2)).existsById(anyKey())
    }

    @Test fun `other integrity failures on like are not swallowed`() {
        published()
        comment("c1")
        val failing = mock(EpisodeCommentLikeRepository::class.java)
        `when`(failing.existsById(anyKey())).thenReturn(false)
        `when`(failing.saveAndFlush(anyLike())).thenThrow(DataIntegrityViolationException("foreign key"))

        assertThrows(DataIntegrityViolationException::class.java) { EpisodeCommentService(access, current, comments, failing, nicknames).like("work", 1, "c1", "fan") }
    }

    @Test fun `a hidden comment is a placeholder in list and detail while author likes and flags stay and the stored row is untouched`() {
        published()
        val row = comment("c1", author = "reader", body = "원문", quote = "인용", spoiler = true, hidden = true)
        comment("c2", author = "other", at = t0.plusSeconds(1), body = "보이는 글", quote = "보이는 인용")
        like("c1", "fan"); like("c1", "reader")

        val items = service.list("work", 1, null, "reader").items.associateBy { it.id }

        for (shown in listOf(items.getValue("c1"), service.read("work", 1, "c1", "reader"))) {
            assertEquals(listOf<Any?>(true, "", null), listOf(shown.hidden, shown.body, shown.quote))
            assertEquals(listOf<Any?>("reader-닉", true, 2, true, true), listOf(shown.authorName, shown.spoiler, shown.likeCount, shown.liked, shown.mine))
        }
        assertEquals(listOf<Any?>(false, "보이는 글", "보이는 인용"), items.getValue("c2").let { listOf(it.hidden, it.body, it.quote) })
        // 자리표시는 응답에서만 만든다. 저장된 원문을 비우면 복구해도 되살릴 수 없다.
        assertEquals(listOf<Any?>("원문", "인용"), listOf(row.body, row.quote))
    }

    @Test fun `a hidden comment refuses edit like and cancel with 409 COMMENT_HIDDEN and changes nothing while its author can still delete it`() {
        published()
        val row = comment("c1", body = "원문", hidden = true)
        like("c1", "reader")
        val calls = listOf<Pair<String, () -> Any?>>(
            "update" to { service.update("work", 1, "c1", "author", UpdateCommentRequest("고침", true)) },
            "like" to { service.like("work", 1, "c1", "fan") },
            "unlike" to { service.unlike("work", 1, "c1", "reader") },
        )

        for ((name, call) in calls) failure { call() }.let { assertEquals(listOf<Any?>(409, "COMMENT_HIDDEN"), listOf(it.status, it.code), name) }

        assertEquals(listOf<Any?>("원문", false, t0), listOf(row.body, row.spoiler, row.updatedAt))
        assertEquals(listOf("reader"), likeRows.map { it.memberId })
        service.delete("work", 1, "c1", "author")
        assertNotNull(row.deletedAt)
    }

    @Test fun `private or missing works are 404 for every operation before any comment access`() {
        `when`(access.published("work")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        for ((name, call) in operations) assertEquals(404, failure { call() }.status, name)

        verifyNoInteractions(current, comments, likes, nicknames)
    }

    @Test fun `unpublished or unknown episodes are 404 for every operation before any comment access`() {
        `when`(current.findByWorkIdAndSequence("work", 1)).thenReturn(EpisodeCurrentEntity("episode-1", "work", 1, null))

        for ((name, call) in operations) assertEquals(404, failure { call() }.status, name)
        for (number in listOf(2, 0, -1)) assertEquals(404, failure { service.list("work", number, null, null) }.status, "episode $number")

        verifyNoInteractions(comments, likes, nicknames)
    }
}
