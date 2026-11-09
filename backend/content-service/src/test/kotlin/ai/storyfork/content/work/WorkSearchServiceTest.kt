package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
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
 * 공개 목록·검색·랭킹의 Service 조립(필터→정렬→views 채우기)을 저장소 대역으로 검증한다. 순수 규칙은 WorkSearchTest가 맡는다.
 * 작가명은 소유자의 Core 최신 닉네임이므로 Core는 대역이고, 작품 행의 author_name 칼럼은 읽지 않는다는 것도 함께 본다.
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
    @Mock lateinit var nicknames: CoreNicknameService
    @InjectMocks lateinit var service: WorkService

    private val start = Instant.parse("2026-11-01T00:00:00Z")
    private val rows = mutableListOf<WorkEntity>()
    // Core 닉네임 대역: 소유자 id → 닉네임이다. 없는 id는 Core에 없는(탈퇴한) 회원이고, asked는 Core에 물은 id 묶음(호출마다 하나)이다.
    private val names = mutableMapOf<String, String>()
    private val asked = mutableListOf<List<String>>()

    @BeforeEach fun core() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            val ids = (call.arguments[0] as Collection<*>).map { it as String }
            asked += ids
            ids.filter { it in names }.associateWith { names.getValue(it) }
        }
    }

    /**
     * [age]가 클수록 늦게 만든 작품이다. 소유자는 [owner]이고 [author]는 그 소유자의 Core 닉네임이다(null이면 등록하지 않는다).
     * 작품 행의 author_name에는 일부러 다른 값을 넣어 두어, 이 값을 읽으면 테스트가 실패하게 한다.
     */
    private fun work(id: String, title: String, age: Long, tags: List<String> = emptyList(), genre: String? = null, visible: String = "public", restricted: Boolean = false, author: String? = "작성자", owner: String = "owner-$id") {
        if (author != null) names[owner] = author
        rows += WorkEntity(id = id, ownerId = owner, title = title, description = "", originKind = "original", createdAt = start.plusSeconds(age), restricted = restricted, authorName = "DB-작가명")
        `when`(works.findAll()).thenReturn(rows)
        `when`(works.findAllById(ArgumentMatchers.anyIterable<String>())).thenAnswer { call ->
            val ids = call.getArgument<Iterable<String>>(0).toSet()
            rows.filter { it.id in ids }
        }
        val result = WorkAccessResult(id, owner, title, "", 0, "world", visible, false, false, null, restricted)
        `when`(access.get(id)).thenReturn(result)
        `when`(access.published(id)).thenReturn(result)
        `when`(access.own(id, owner)).thenReturn(result)
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

    @Test fun `author search matches the owner's Core nickname only and all includes it`() {
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
        // 작품 행의 author_name은 읽지 않는다.
        assertEquals(emptyList<String>(), ids("DB", "author"))
        assertEquals(emptyList<String>(), ids("DB", "all"))
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

        verifyNoInteractions(works, access, viewService, nicknames)
    }

    @Test fun `a public list asks Core once for its distinct owners and shows their latest nicknames`() {
        work("a", "첫째", 1, author = "윤서하")
        work("b", "둘째", 2, author = null)
        work("c", "셋째", 3, author = null, owner = "owner-a")
        views()

        val items = service.publicList(null, null, null).items

        assertEquals(mapOf("a" to "윤서하", "b" to "탈퇴한 회원", "c" to "윤서하"), items.associate { it.id to it.authorName })
        assertEquals(1, asked.size)
        assertEquals(setOf("owner-a", "owner-b"), asked.single().toSet())
    }

    @Test fun `ranking asks Core only for the owners of the ranked works`() {
        for (i in 1..12) work("w$i", "작품 $i", i.toLong(), author = "작가 $i")
        views(*(1..12).map { Triple("w$it", it.toLong(), 0L) }.toTypedArray())

        val top = service.ranking("top").items

        assertEquals((12 downTo 3).map { "작가 $it" }, top.map { it.authorName })
        assertEquals(1, asked.size)
        assertEquals((3..12).map { "owner-w$it" }.toSet(), asked.single().toSet())
    }

    @Test fun `an empty public list or ranking looks up no member`() {
        `when`(works.findAll()).thenReturn(emptyList())
        views()

        assertEquals(emptyList<String>(), service.publicList(null, null, null).items.map { it.id })
        assertEquals(emptyList<String>(), service.ranking("top").items.map { it.id })
        // 빈 묶음은 CoreNicknameService가 Core를 부르지 않고 돌려보낸다(CoreNicknameServiceTest).
        assertTrue(asked.flatten().isEmpty())
    }

    @Test fun `detail reads of a public work and of the owner's own works show the owner's Core nickname`() {
        work("a", "첫째", 1, author = "윤서하")
        work("b", "둘째", 2, author = null)
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("owner-a")).thenReturn(rows.filter { it.ownerId == "owner-a" })

        assertEquals("윤서하", service.publicRead("a").authorName)
        assertEquals("탈퇴한 회원", service.publicRead("b").authorName)
        assertEquals("윤서하", service.read("a", "owner-a").authorName)
        assertEquals(listOf("윤서하"), service.list("owner-a").items.map { it.authorName })
    }

    @Test fun `the owner list asks Core before taking the row locks`() {
        work("a", "첫째", 1, author = "윤서하")
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("owner-a")).thenReturn(rows.toList())

        assertEquals(listOf("윤서하"), service.list("owner-a").items.map { it.authorName })

        // lockScopes는 PESSIMISTIC_WRITE 잠금(원작 행 포함)을 쥐므로 그 전에 외부 호출을 끝내야 한다. 목록의 소유자는 모두 owner라 한 번이면 된다.
        val order = inOrder(nicknames, access)
        order.verify(nicknames).nicknames(listOf("owner-a"))
        order.verify(access).lockScopes(ArgumentMatchers.anyCollection<String>())
        assertEquals(listOf(listOf("owner-a")), asked)
    }

    @Test fun `the owner list takes no row locks when Core fails and asks nobody when the owner has no works`() {
        work("a", "첫째", 1)
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("owner-a")).thenReturn(rows.toList())
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("nobody")).thenReturn(emptyList())
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        doThrow(failure).`when`(nicknames).nicknames(ArgumentMatchers.anyCollection<String>())

        assertSame(failure, assertThrows(CoreAuthException::class.java) { service.list("owner-a") })
        verify(access, never()).lockScopes(ArgumentMatchers.anyCollection<String>())
        // 작품이 없으면 Core를 부르지 않으므로 Core가 장애여도 빈 목록은 그대로 돌려준다.
        assertEquals(emptyList<String>(), service.list("nobody").items.map { it.id })
    }

    @Test fun `public episodes check the work is public and read its published episodes without asking Core`() {
        work("a", "첫째", 1)
        `when`(publication.publishedEpisodes("a")).thenReturn(PublishedEpisodeListResponse(listOf(PublishedEpisodeResponse(1, 3, "v1", "1화", "본문", false))))
        `when`(access.published("hidden")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(listOf("본문"), service.publicEpisodes("a").map { it.body })
        assertEquals(404, failure { service.publicEpisodes("hidden") }.status)

        // 표지·이미지 공개 열람처럼 이름이 필요 없는 내부 호출은 Core 가용성에 묶이지 않는다.
        verifyNoInteractions(nicknames)
    }

    @Test fun `a Core failure fails the list search ranking and detail instead of hiding the names`() {
        work("a", "첫째", 1)
        views(Triple("a", 1, 0))
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        val calls = listOf<Pair<String, () -> Any>>(
            "list" to { service.publicList(null, null, null) },
            "author search" to { service.publicList("a", "author", null) },
            "ranking" to { service.ranking("top") },
            "detail" to { service.publicRead("a") },
        )
        for ((name, call) in calls) assertSame(failure, assertThrows(CoreAuthException::class.java) { call() }, name)
    }
}
