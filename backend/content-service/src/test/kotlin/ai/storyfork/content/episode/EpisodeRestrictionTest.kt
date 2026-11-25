package ai.storyfork.content.episode

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.controller.InternalEpisodeController
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.InternalEpisodeService
import ai.storyfork.content.episode.service.dto.OperationsEpisodeResponse
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.dto.WorkAccessResult
import jakarta.persistence.Column
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.data.jpa.repository.Query
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod

/**
 * 운영자의 회차 제한(독자에게만 숨기고 작가 집필은 유지)을 DB 없이 검증한다. 독자 경로별 404는 각 서비스 테스트가,
 * 뷰 SQL이 실제로 도는지는 CI 통합 테스트가 확인한다.
 */
class EpisodeRestrictionTest {
    private val works = mock(WorkRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val service = InternalEpisodeService(works, current, episodes)
    private val work = WorkEntity(id = "work", ownerId = "author", title = "작품")

    /** 쿼리 한 줄이다: [번호, 발행 버전 제목, 초안 제목, 발행 상태, 제한 여부, 상속 여부]. */
    private fun row(number: Int, published: String? = null, draft: String? = null, status: String = "published", restricted: Boolean = false, inherited: Boolean = false): Array<Any?> =
        arrayOf(number, published, draft, status, restricted, inherited)
    private fun rows(vararg rows: Array<Any?>) = `when`(current.operationsRows("work")).thenReturn(rows.toList())
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    // --- 독자와 작가가 보는 값 ---
    @Test fun `a restricted episode has no reader version but the author still sees the published one`() {
        val open = EpisodeCurrentEntity("e", "w", 1, "v1")
        val shut = EpisodeCurrentEntity("e", "w", 1, "v1", restricted = true)

        assertEquals("v1", open.readerVersionId)
        assertNull(shut.readerVersionId)
        assertEquals("v1", shut.publishedVersionId)
        assertNull(EpisodeCurrentEntity("e", "w", 1, null).readerVersionId)
    }

    @Test fun `readers lose restricted episodes and the rest keep their numbers and bodies`() {
        val work = WorkAccessResult("w", "author", "제목", "", 0, "world", "public", true, false, null)
        val items = listOf(PublishedEpisodeResponse(1, 1, "v1", "1화", "본문1"), PublishedEpisodeResponse(2, 1, "v2", "2화", "본문2", restricted = true),
            PublishedEpisodeResponse(3, 1, "v3", "3화", "본문3"))

        assertEquals(listOf(1, 3), work.readerEpisodes(items).map { it.number })
        assertEquals(listOf("본문1", "본문3"), work.readerEpisodes(items).map { it.body })
    }

    @Test fun `a restricted inherited episode is dropped while the other inherited bodies of a deleted original stay blank`() {
        val fork = WorkAccessResult("f", "author", "제목", "", 0, "world", "public", false, false, SourceResponse("o", "원작", 2, 1, "", deleted = true))
        val items = listOf(PublishedEpisodeResponse(1, 1, "v1", "1화", "원작1", inherited = true),
            PublishedEpisodeResponse(2, 1, "v2", "2화", "원작2", inherited = true, restricted = true), PublishedEpisodeResponse(3, 1, "v3", "3화", "내 글"))

        val shown = fork.readerEpisodes(items)

        assertEquals(listOf(1, 3), shown.map { it.number })
        assertEquals(listOf("", "내 글"), shown.map { it.body })
    }

    // --- 운영 내부 API ---
    @Test fun `the list is the numbered episodes without bodies with the published title first then the draft title`() {
        `when`(works.findById("work")).thenReturn(Optional.of(work))
        rows(row(1, "1화 발행", "1화 초안"), row(2, null, "2화 초안", "draft"), row(3, "상속 제목", null, restricted = true, inherited = true), row(4, null, null, "suspended"))

        assertEquals(listOf(
            OperationsEpisodeResponse(1, "1화 발행", "published", false, false),
            OperationsEpisodeResponse(2, "2화 초안", "draft", false, false),
            OperationsEpisodeResponse(3, "상속 제목", "published", true, true),
            OperationsEpisodeResponse(4, "", "suspended", false, false),
        ), service.list("work"))
    }

    @Test fun `a missing or soft deleted work is 404 before any episode query`() {
        val gone = WorkEntity(id = "gone", ownerId = "author", title = "삭제", deletedAt = Instant.now())
        `when`(works.findById("gone")).thenReturn(Optional.of(gone))
        `when`(works.lockAll(listOf("gone"))).thenReturn(listOf(gone))

        for (call in listOf<() -> Unit>({ service.list("gone") }, { service.list("none") }, { service.restrict("gone", 1, true) }, { service.restrict("none", 1, false) }))
            assertEquals(404, failure(call).status)

        verifyNoInteractions(current, episodes)
    }

    @Test fun `restrict and unrestrict flip the flag under the work lock and answer with the episode`() {
        `when`(works.lockAll(listOf("work"))).thenReturn(listOf(work))
        rows(row(1, "1화"), row(2, "2화"))
        val episode = EpisodeEntity(id = "e2", workId = "work", sequence = 2)
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(episode)

        assertEquals(OperationsEpisodeResponse(2, "2화", "published", true, false), service.restrict("work", 2, true))
        assertTrue(episode.restricted)
        assertEquals(OperationsEpisodeResponse(2, "2화", "published", false, false), service.restrict("work", 2, false))
        assertFalse(episode.restricted)
        verify(works, times(2)).lockAll(listOf("work"))
    }

    @Test fun `an inherited episode is 409 EPISODE_INHERITED and nothing changes`() {
        `when`(works.lockAll(listOf("work"))).thenReturn(listOf(work))
        rows(row(1, "상속", inherited = true))

        val failure = failure { service.restrict("work", 1, true) }

        assertEquals(409 to "EPISODE_INHERITED", failure.status to failure.code)
        verify(episodes, never()).findByWorkIdAndSequence(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
    }

    @Test fun `an unknown episode number is 404 and nothing changes`() {
        `when`(works.lockAll(listOf("work"))).thenReturn(listOf(work))
        rows(row(1, "1화"))

        assertEquals(404, failure { service.restrict("work", 9, true) }.status)
        verify(episodes, never()).findByWorkIdAndSequence(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
    }

    @Test fun `the public list basis query counts only published episodes that are not restricted`() {
        val query = WorkRepository::class.java.methods.single { it.name == "lastPublishedOfPublicWorks" }.getAnnotation(Query::class.java).value
        assertTrue(query.contains("c.publishedVersionId is not null and c.restricted = false"), query)
    }

    private fun route(type: Class<*>, name: String): Pair<String, List<RequestMethod>> {
        val method = type.methods.single { it.name == name }
        val base = AnnotatedElementUtils.findMergedAnnotation(type, RequestMapping::class.java)!!.path.singleOrNull().orEmpty()
        val mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping::class.java)!!
        return (base + mapping.path.singleOrNull().orEmpty()) to mapping.method.toList()
    }

    @Test fun `the internal API keeps the contract paths and methods`() {
        val internal = InternalEpisodeController::class.java
        assertEquals("/internal/v1/works/{workId}/episodes" to listOf(RequestMethod.GET), route(internal, "list"))
        assertEquals("/internal/v1/works/{workId}/episodes/{number}/restriction" to listOf(RequestMethod.PUT), route(internal, "restrict"))
        assertEquals("/internal/v1/works/{workId}/episodes/{number}/restriction" to listOf(RequestMethod.DELETE), route(internal, "unrestrict"))
    }

    // --- 스키마(V46) ---
    private val v46 = Files.readString(Path.of("src/main/resources/db/migration/episode/V46__episode_restriction.sql"))

    @Test fun `V46 adds the flag and appends it to the view after the V31 columns`() {
        assertTrue(v46.contains("ALTER TABLE episode ADD COLUMN restricted boolean NOT NULL DEFAULT false;"))
        val view = v46.substringAfter("CREATE OR REPLACE VIEW episode_current")
        // CREATE OR REPLACE VIEW는 기존 열의 이름·순서를 바꾸지 못하고 새 열은 끝에만 더한다.
        val order = listOf("e.draft_revision_floor", "published_version_id", "inherited", "publication_status", "restricted").map { view.indexOf(it) }
        assertTrue(order.all { it > 0 } && order == order.sorted(), "열 순서: $order")
        // 상속 회차는 Fork가 물려받은 원작 회차(se)의 제한을 따른다.
        assertTrue(view.contains("SELECT local.id,se.restricted FROM checkpoint_episode ce JOIN episode se ON se.id=ce.episode_id"))
        assertTrue(view.contains("(e.restricted OR COALESCE(iv.restricted,false)) restricted"))
    }

    @Test fun `both entities map the restricted column`() {
        fun columns(type: Class<*>) = type.declaredFields.mapNotNull { it.getAnnotation(Column::class.java)?.name }
        assertTrue("restricted" in columns(EpisodeEntity::class.java))
        assertTrue("restricted" in columns(EpisodeCurrentEntity::class.java))
    }
}
