package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.work.domain.WorkViews
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.repository.*
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.mockito.junit.jupiter.MockitoSettings
import org.mockito.quality.Strictness

/** 공개 목록·검색·랭킹의 Service 조립(필터→정렬→views 채우기)을 저장소 대역으로 검증한다. 순수 규칙은 WorkSearchTest가 맡는다. */
@ExtendWith(MockitoExtension::class)
@MockitoSettings(strictness=Strictness.LENIENT)
class WorkSearchServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var members: ContentMemberService
    @Mock lateinit var works: WorkRepository
    @Mock lateinit var worlds: WorldRepository
    @Mock lateinit var workWorlds: WorkWorldHistoryRepository
    @Mock lateinit var visibility: WorkPublicationHistoryRepository
    @Mock lateinit var policies: ForkPolicyHistoryRepository
    @Mock lateinit var selectedPolicyEpisodes: ForkPolicyEpisodeRepository
    @Mock lateinit var genreRows: GenreRepository
    @Mock lateinit var workGenres: WorkGenreRepository
    @Mock lateinit var hashtagRows: WorkHashtagRepository
    @Mock lateinit var rightsRows: WorkRightsDeclarationRepository
    @Mock lateinit var episodes: EpisodeRepository
    @Mock lateinit var drafts: EpisodeDraftRepository
    @Mock lateinit var publication: PublicationService
    @Mock lateinit var versions: EpisodeVersionService
    @Mock lateinit var proposals: ProposalService
    @Mock lateinit var settings: SettingDocumentRepository
    @Mock lateinit var viewService: WorkViewService
    @InjectMocks lateinit var service: WorkService

    private val start = Instant.parse("2026-11-01T00:00:00Z")
    private val rows = mutableListOf<WorkEntity>()

    /** [age]가 클수록 늦게 만든 작품이다. */
    private fun work(id: String, title: String, age: Long, tags: List<String> = emptyList(), genre: String? = null, visible: String = "public", author: String = "작성자") {
        rows += WorkEntity(id = id, ownerId = "author", title = title, description = "", originKind = "original", createdAt = start.plusSeconds(age), authorName = author)
        `when`(works.findAll()).thenReturn(rows)
        `when`(access.get(id)).thenReturn(WorkAccessResult(id, "author", title, "", 0, "world", visible, false, false, null))
        if (visible != "public") return
        `when`(works.findById(id)).thenReturn(Optional.of(rows.last()))
        `when`(publication.publishedEpisodes(id)).thenReturn(PublishedEpisodeListResponse(emptyList()))
        `when`(hashtagRows.findAllByWorkIdOrderByPosition(id)).thenReturn(tags.mapIndexed { i, tag -> WorkHashtagEntity("$id-tag-$i", id, tag, i) })
        if (genre != null) {
            `when`(workGenres.findAllByWorkId(id)).thenReturn(listOf(WorkGenreEntity(id, "genre-$genre")))
            `when`(genreRows.findAllById(listOf("genre-$genre"))).thenReturn(listOf(GenreEntity("genre-$genre", "genre-$genre", genre)))
        }
    }
    private fun views(vararg counts: Triple<String, Long, Long>) {
        `when`(viewService.counts()).thenReturn(counts.associate { (id, recent, prior) -> id to WorkViews(recent, prior) })
    }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `list without options keeps newest first public works and fills recent views`() {
        work("old", "옛 작품", 1)
        work("new", "새 작품", 2)
        work("hidden", "비공개", 3, visible = "private")
        views(Triple("old", 4, 1))

        val items = service.publicList(null, null, null).items

        assertEquals(listOf("new", "old"), items.map { it.id })
        assertEquals(listOf(0L, 4L), items.map { it.views })
    }

    @Test fun `search filters by field and view sort orders by recent views`() {
        work("a", "달빛 정원", 1, tags = listOf("회귀"), genre = "판타지")
        work("b", "별빛 서점", 2, tags = listOf("달빛"), genre = "로맨스")
        work("c", "우주 정거장", 3, genre = "SF")
        views(Triple("a", 5, 0), Triple("b", 1, 0))

        fun ids(q: String?, f: String?, sort: String?) = service.publicList(q, f, sort).items.map { it.id }

        assertEquals(listOf("b", "a"), ids("달빛", "all", "latest"))
        assertEquals(listOf("a"), ids("달빛", "title", null))
        assertEquals(listOf("b"), ids("#달빛", "tag", null))
        assertEquals(listOf("c"), ids("sf", "genre", null))
        assertEquals(listOf("a", "b"), ids("달빛", null, "view"))
        assertEquals(listOf("c", "b", "a"), ids(null, null, null))
    }

    @Test fun `author search matches the author name only and all includes it`() {
        work("a", "달빛 정원", 1, author = "윤서하")
        work("b", "별빛 서점", 2, author = "Writer Kim")
        work("c", "우주 정거장", 3)
        views()

        fun ids(q: String?, f: String?) = service.publicList(q, f, null).items.map { it.id }

        assertEquals(listOf("a"), ids("윤서", "author"))
        assertEquals(listOf("b"), ids(" writer ", "author"))
        assertEquals(emptyList<String>(), ids("정원", "author"))
        assertEquals(listOf("b"), ids("kim", "all"))
        assertEquals(listOf("c", "b", "a"), ids(" ", "author"))
    }

    @Test fun `ranking lists only works with a positive score and fills their recent views`() {
        work("a", "첫째", 1)
        work("b", "둘째", 2)
        work("c", "셋째", 3)
        views(Triple("a", 3, 0), Triple("b", 2, 5), Triple("c", 0, 4))

        val top = service.ranking("top").items
        val rising = service.ranking("rising").items

        assertEquals(listOf("a", "b"), top.map { it.id })
        assertEquals(listOf(3L, 2L), top.map { it.views })
        assertEquals(listOf("a"), rising.map { it.id })
    }

    @Test fun `unknown options fail with 422 before any lookup`() {
        for (call in listOf<() -> Any>({ service.publicList(null, "body", null) }, { service.publicList(null, null, "popular") }, { service.ranking("daily") })) {
            assertEquals(422, failure { call() }.status)
        }

        verifyNoInteractions(works, access, viewService)
    }
}
