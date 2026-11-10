package ai.storyfork.content.comment

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.comment.entity.EpisodeCommentEntity
import ai.storyfork.content.comment.entity.EpisodeCommentLikeEntity
import ai.storyfork.content.comment.repository.EpisodeCommentLikeRepository
import ai.storyfork.content.comment.repository.EpisodeCommentRepository
import ai.storyfork.content.comment.service.InternalCommentService
import ai.storyfork.content.comment.service.dto.OperationsCommentListResponse
import ai.storyfork.content.comment.service.dto.OperationsCommentResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*

/** 운영 댓글 목록 매핑과 숨김·복구 규칙을 저장소·Core 닉네임 mock으로 검증한다. 실제 SQL·HTTP는 InternalCommentIntegrationTest가 CI에서 확인한다. */
class InternalCommentServiceTest {
    private val comments = mock(EpisodeCommentRepository::class.java)
    private val likes = mock(EpisodeCommentLikeRepository::class.java)
    private val works = mock(WorkRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = InternalCommentService(comments, likes, works, nicknames)
    private val t0 = Instant.parse("2020-01-01T00:00:00Z")

    private fun comment(id: String, work: String = "w1", author: String = "a1", body: String = "본문-$id", number: Int = 1, hidden: Boolean = false, at: Instant = t0) =
        EpisodeCommentEntity(id = id, workId = work, episodeNumber = number, publishedVersionId = "v", authorId = author, body = body, createdAt = at, updatedAt = at, hidden = hidden)
    private fun rowOf(comment: EpisodeCommentEntity, title: String = "작품") = arrayOf<Any?>(comment, title)
    private fun coreNames(vararg names: Pair<String, String>) {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenReturn(mapOf(*names))
    }
    /** 단건 숨김·복구가 읽는 댓글 한 건과 그 작품, 공감 행([likeCount]개)을 준비한다. */
    private fun stored(row: EpisodeCommentEntity, title: String = "작품A", likeCount: Int = 2) {
        `when`(comments.findById(row.id)).thenReturn(Optional.of(row))
        `when`(works.findById(row.workId)).thenReturn(Optional.of(WorkEntity(id = row.workId, ownerId = "owner", title = title)))
        `when`(likes.findAllByCommentIdIn(listOf(row.id))).thenReturn(List(likeCount) { EpisodeCommentLikeEntity(row.id, "m$it") })
    }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `list maps every row in repository order with title like count and Core nickname and keeps the original body of hidden comments`() {
        val shown = comment("c1", work = "w1", author = "a1", number = 2)
        val hidden = comment("c2", work = "w2", author = "a2", body = "숨긴 원문", hidden = true, at = t0.plusSeconds(1))
        `when`(comments.listForOperations()).thenReturn(listOf(rowOf(shown, "작품A"), rowOf(hidden, "작품B")))
        `when`(likes.countAllByComment()).thenReturn(listOf(arrayOf<Any?>("c1", 3L)))
        coreNames("a1" to "닉1")

        assertEquals(
            OperationsCommentListResponse(listOf(
                OperationsCommentResponse("c1", "w1", "작품A", 2, "a1", "닉1", "본문-c1", 3, false, t0),
                OperationsCommentResponse("c2", "w2", "작품B", 1, "a2", WITHDRAWN_MEMBER_NAME, "숨긴 원문", 0, true, t0.plusSeconds(1)),
            )),
            service.list(),
        )
        // N+1 금지: 목록과 공감 수를 쿼리 한 번씩 읽고 댓글·작품·공감 단건 조회는 하지 않는다.
        verify(comments).listForOperations()
        verify(likes).countAllByComment()
        verifyNoMoreInteractions(comments, likes, works)
    }

    @Test fun `all authors of the list are looked up from Core in a single call`() {
        `when`(comments.listForOperations()).thenReturn(listOf(rowOf(comment("c1", author = "a1")), rowOf(comment("c2", author = "a2")), rowOf(comment("c3", author = "a1"))))
        val asked = mutableListOf<Collection<*>>()
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            asked += call.arguments[0] as Collection<*>
            mapOf("a1" to "닉1", "a2" to "닉2")
        }

        assertEquals(listOf("닉1", "닉2", "닉1"), service.list().items.map { it.authorName })
        assertEquals(setOf("a1", "a2"), asked.single().toSet())
    }

    @Test fun `a Core failure fails the list and is never replaced by a name`() {
        `when`(comments.listForOperations()).thenReturn(listOf(rowOf(comment("c1"))))
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        assertSame(failure, assertThrows(CoreAuthException::class.java) { service.list() })
    }

    @Test fun `no comments is an empty items list and Core is not called`() {
        val core = mock(CoreAuthClient::class.java)
        `when`(comments.listForOperations()).thenReturn(emptyList())

        assertEquals(OperationsCommentListResponse(emptyList()), InternalCommentService(comments, likes, works, CoreNicknameService(core)).list())
        verifyNoInteractions(core)
    }

    @Test fun `hide and restore flip only the hidden flag are idempotent and answer with the original body`() {
        val row = comment("c1", number = 3, body = "원문")
        stored(row)
        coreNames("a1" to "닉1")
        val hidden = OperationsCommentResponse("c1", "w1", "작품A", 3, "a1", "닉1", "원문", 2, true, t0)

        assertEquals(hidden, service.hide("c1"))
        assertEquals(hidden, service.hide("c1"))
        assertTrue(row.hidden)
        assertEquals(hidden.copy(hidden = false), service.restore("c1"))
        assertEquals(hidden.copy(hidden = false), service.restore("c1"))
        assertFalse(row.hidden)
        // 숨김·복구는 수정이 아니라서 공개 응답의 edited(updatedAt > createdAt)를 켜지 않는다.
        assertEquals(listOf<Any?>("원문", t0), listOf(row.body, row.updatedAt))
    }

    @Test fun `a missing deleted or deleted work comment is 404 for hide and restore and stays as it was`() {
        val deleted = comment("deleted").also { it.deletedAt = t0 }
        val orphan = comment("orphan", work = "gone-work", hidden = true)
        stored(deleted)
        stored(orphan)
        `when`(works.findById("gone-work")).thenReturn(Optional.of(WorkEntity(id = "gone-work", ownerId = "owner", title = "삭제 작품", deletedAt = t0)))
        `when`(comments.findById("missing")).thenReturn(Optional.empty())

        for (id in listOf("missing", "deleted", "orphan")) {
            assertEquals(404, failure { service.hide(id) }.status, "hide $id")
            assertEquals(404, failure { service.restore(id) }.status, "restore $id")
        }

        assertEquals(listOf(false, true), listOf(deleted.hidden, orphan.hidden))
    }
}
