package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.service.MemberNicknameService
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.domain.WorkViews
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.repository.*
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.ArgumentMatchers
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.mockito.junit.jupiter.MockitoSettings
import org.mockito.quality.Strictness

/**
 * 공개 목록·검색·랭킹의 Service 조립(필터→정렬→views 채우기)과 소유자 Core 닉네임으로 채우는 작가명을 저장소·Core 대역으로 검증한다.
 * 순수 규칙은 WorkSearchTest가 맡는다.
 */
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
    @Mock lateinit var nicknames: MemberNicknameService
    @InjectMocks lateinit var service: WorkService

    private val start = Instant.parse("2026-11-01T00:00:00Z")
    private val rows = mutableListOf<WorkEntity>()
    /** Core가 아는 소유자 닉네임. 소유자 id는 `owner-<작품 id>`이고 [work]가 채운다. */
    private val coreNames = mutableMapOf<String, String>()
    private val lookups = mutableListOf<Collection<String>>()

    @BeforeEach fun coreNicknames() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            val owners = call.getArgument<Collection<String>>(0)
            lookups += owners
            coreNames.filterKeys { it in owners }
        }
    }

    /** [age]가 클수록 늦게 만든 작품이다. */
    private fun work(id: String, title: String, age: Long, tags: List<String> = emptyList(), genre: String? = null, visible: String = "public", restricted: Boolean = false, author: String = "작성자") {
        // work.author_name 칼럼은 더 이상 읽지 않는다. 일부러 다른 값을 넣어 칼럼이 새어 나오면 단언이 깨지게 한다.
        rows += WorkEntity(id = id, ownerId = "owner-$id", title = title, description = "", originKind = "original", createdAt = start.plusSeconds(age), restricted = restricted, authorName = "칼럼 작가")
        coreNames["owner-$id"] = author
        `when`(works.findAll()).thenReturn(rows)
        `when`(works.findAllById(ArgumentMatchers.anyIterable<String>())).thenAnswer { call ->
            val ids = call.getArgument<Iterable<String>>(0).toSet()
            rows.filter { it.id in ids }
        }
        `when`(access.get(id)).thenReturn(WorkAccessResult(id, "owner-$id", title, "", 0, "world", visible, false, false, null, restricted))
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

    @Test fun `restricted works are left out of author search and all search`() {
        work("open", "공개 작품", 1, author = "윤서하")
        work("blocked", "제한 작품", 2, restricted = true, author = "윤서하")
        views()

        assertEquals(listOf("open"), service.publicList("윤서", "author", null).items.map { it.id })
        assertEquals(listOf("open"), service.publicList("윤서", "all", null).items.map { it.id })
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

    @Test fun `ranking reads only works with views and assembles only the top ten visible ones`() {
        for (i in 1..12) work("w$i", "작품 $i", i.toLong())
        work("quiet", "조회 없음", 13)
        work("blocked", "제한 작품", 14, restricted = true)
        views(*(listOf(Triple("blocked", 99L, 0L)) + (1..12).map { Triple("w$it", it.toLong(), 0L) }).toTypedArray())

        val top = service.ranking("top").items

        assertEquals((12 downTo 3).map { "w$it" }, top.map { it.id })
        assertEquals((12 downTo 3).map { it.toLong() }, top.map { it.views })
        verify(works, never()).findAll()
        verify(access, never()).get("quiet")
        verify(publication, times(10)).publishedEpisodes(ArgumentMatchers.anyString())
        assertEquals(1, lookups.size, "순위 응답 하나에 Core를 한 번만 부른다")
        assertEquals((3..12).map { "owner-w$it" }.toSet(), lookups.single().toSet(), "순위에 든 작품의 소유자만 조회한다")
    }

    @Test fun `restricted public works are left out of list search and both rankings`() {
        work("open", "공개 작품", 1)
        work("blocked", "제한 작품", 2, restricted = true)
        views(Triple("open", 1, 0), Triple("blocked", 9, 0))

        assertEquals(listOf("open"), service.publicList(null, null, null).items.map { it.id })
        assertEquals(listOf("open"), service.publicList("작품", "title", "view").items.map { it.id })
        assertEquals(listOf("open"), service.ranking("top").items.map { it.id })
        assertEquals(listOf("open"), service.ranking("rising").items.map { it.id })
    }

    @Test fun `unknown options fail with 422 before any lookup`() {
        for (call in listOf<() -> Any>({ service.publicList(null, "body", null) }, { service.publicList(null, null, "popular") }, { service.ranking("daily") })) {
            assertEquals(422, failure { call() }.status)
        }

        verifyNoInteractions(works, access, viewService)
    }

    @Test fun `list fills author names from one nickname lookup and shows unknown owners as withdrawn`() {
        work("a", "달빛 정원", 1, author = "윤서하")
        work("b", "별빛 서점", 2, author = "Writer Kim")
        work("c", "우주 정거장", 3)
        work("hidden", "비공개", 4, visible = "private")
        coreNames.remove("owner-c")
        views()

        val items = service.publicList(null, null, null).items

        assertEquals(listOf("c", "b", "a"), items.map { it.id })
        assertEquals(listOf("탈퇴한 회원", "Writer Kim", "윤서하"), items.map { it.authorName })
        assertEquals(listOf("owner-c", "owner-b", "owner-a"), items.map { it.ownerId })
        assertEquals(1, lookups.size, "응답 하나에 소유자 조회는 한 번(N+1 금지)")
        assertEquals(setOf("owner-a", "owner-b", "owner-c"), lookups.single().toSet(), "공개 작품의 소유자만 조회한다")
    }

    @Test fun `author search matches the looked up nickname and not the stored column`() {
        work("a", "달빛 정원", 1, author = "윤서하")
        work("b", "별빛 서점", 2)
        coreNames.remove("owner-b")
        views()

        fun ids(q: String?, f: String?) = service.publicList(q, f, null).items.map { it.id }

        assertEquals(listOf("a"), ids("윤서", "author"))
        assertEquals(emptyList<String>(), ids("칼럼", "all"), "work.author_name 칼럼은 검색에도 쓰지 않는다")
        assertEquals(listOf("b"), ids("탈퇴한", "author"), "Core에 없는 소유자는 탈퇴한 회원으로 검색된다")
    }

    @Test fun `Core failure is not hidden behind a made up author name`() {
        work("a", "달빛 정원", 1)
        views(Triple("a", 3, 0))
        doThrow(ContentFailure(503, "작가 정보를 불러오지 못했어요.")).`when`(nicknames).nicknames(ArgumentMatchers.anyCollection<String>())

        assertEquals(503, failure { service.publicList(null, null, null) }.status)
        assertEquals(503, failure { service.ranking("top") }.status)
    }

    @Test fun `public detail owner detail and owner list use the Core nickname with one lookup each`() {
        work("a", "달빛 정원", 1, author = "윤서하")
        val visible = access.get("a")
        `when`(access.published("a")).thenReturn(visible)
        `when`(access.own("a", "owner-a")).thenReturn(visible)
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("owner-a")).thenReturn(rows.toList())

        assertEquals("윤서하", service.publicRead("a").authorName)
        assertEquals("윤서하", service.read("a", "owner-a").authorName)
        assertEquals(listOf("윤서하"), service.list("owner-a").items.map { it.authorName })

        assertEquals(List(3) { listOf("owner-a") }, lookups.map { it.toList() })
    }

    @Test fun `owner without works looks up no owners and a hidden public work fails before any lookup`() {
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("nobody")).thenReturn(emptyList())
        `when`(access.published("hidden")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(emptyList<String>(), service.list("nobody").items.map { it.id })
        assertEquals(404, failure { service.publicRead("hidden") }.status)
        assertEquals(emptyList<String>(), lookups.flatten())
    }

    @Test fun `public episodes gate attachments without asking Core for author names`() {
        work("a", "달빛 정원", 1)
        val visible = access.get("a")
        `when`(access.published("a")).thenReturn(visible)
        `when`(publication.publishedEpisodes("a")).thenReturn(PublishedEpisodeListResponse(listOf(PublishedEpisodeResponse(1, 1, "v1", "1화", "본문"))))
        `when`(access.published("hidden")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(listOf(1), service.publicEpisodes("a").map { it.number })
        assertEquals(404, failure { service.publicEpisodes("hidden") }.status)
        verifyNoInteractions(nicknames)
    }
}
