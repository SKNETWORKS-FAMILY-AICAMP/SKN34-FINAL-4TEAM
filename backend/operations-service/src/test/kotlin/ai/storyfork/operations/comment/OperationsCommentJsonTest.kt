package ai.storyfork.operations.comment

import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import tools.jackson.module.kotlin.jacksonMapperBuilder

/**
 * Content `episode_comment.id`·`author_id`는 varchar라 UUID가 아닐 수 있다. 한 행의 비 UUID 값이 목록 전체나 숨김·복구 결과 하나를
 * 읽을 수 없게 만들면 안 된다(502로 보인다).
 */
class OperationsCommentJsonTest {
    private val mapper = jacksonMapperBuilder().build()
    private val nonUuidRow = """
        {"commentId":"ops-comment-1","workId":"ops-work-1","workTitle":"작품","episodeNumber":3,"authorId":"ops-comment-author",
        "authorName":"작가","body":"원문","likeCount":2,"hidden":true,"createdAt":"2026-11-10T01:02:03Z"}
    """.trimIndent()

    @Test
    fun `single comment with non-UUID ids still deserializes`() {
        val comment = mapper.readValue(nonUuidRow, OperationsComment::class.java)

        assertEquals(
            OperationsComment("ops-comment-1", "ops-work-1", "작품", 3, "ops-comment-author", "작가", "원문", 2, true, Instant.parse("2026-11-10T01:02:03Z")),
            comment,
        )
    }

    @Test
    fun `a non-UUID row does not break the list around it`() {
        val uuidAuthor = UUID.randomUUID().toString()
        val uuidRow = nonUuidRow.replace("ops-comment-1", UUID.randomUUID().toString()).replace("ops-comment-author", uuidAuthor)
            .replace("\"hidden\":true", "\"hidden\":false")

        val items = mapper.readValue("""{"items":[$nonUuidRow,$uuidRow]}""", OperationsCommentList::class.java).items

        assertEquals(listOf("ops-comment-author", uuidAuthor), items.map { it.authorId })
        assertEquals(listOf(true, false), items.map { it.hidden })
    }

    @Test
    fun `reading and writing a Content row gives the browser the same JSON`() {
        val parsed = mapper.readValue(nonUuidRow, OperationsComment::class.java)

        assertEquals(mapper.readTree(nonUuidRow), mapper.readTree(mapper.writeValueAsString(parsed)))
    }
}
