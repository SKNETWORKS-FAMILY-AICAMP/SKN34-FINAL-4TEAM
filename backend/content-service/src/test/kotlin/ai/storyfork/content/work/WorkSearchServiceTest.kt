package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.like.service.WorkLikeService
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
import java.time.Duration
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
    @Mock lateinit var likeService: WorkLikeService
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
    private fun work(id: String, title: String, age: Long, tags: List<String> = emptyList(), genre: String? = null, visible: String = "public", restricted: Boolean = false, author: String? = "작성자", owner: String = "owner-$id", fork: Boolean = false, deleted: Boolean = false) {
        if (author != null) names[owner] = author
        rows += WorkEntity(id = id, ownerId = owner, title = title, description = "", originKind = "original", createdAt = start.plusSeconds(age), restricted = restricted, authorName = "DB-작가명", deletedAt = if (deleted) start else null)
        `when`(works.findAll()).thenReturn(rows)
        `when`(works.findAllById(ArgumentMatchers.anyIterable<String>())).thenAnswer { call ->
            val ids = call.getArgument<Iterable<String>>(0).toSet()
            rows.filter { it.id in ids }
        }
        val source = if (fork) SourceResponse("original", "원작", 1, 1, "") else null
        val result = WorkAccessResult(id, owner, title, "", 0, "world", visible, false, false, source, restricted, deleted)
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
    /** 좋아요가 없는 작품은 맵에 담지 않는다(실제 집계 행과 같다). */
    private fun likes(vararg counts: Pair<String, Long>) {
        `when`(likeService.counts(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            call.getArgument<Collection<String>>(0).mapNotNull { id -> counts.toMap()[id]?.let { id to it } }.toMap()
        }
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

    @Test fun `list search and ranking fill likes with one batched count of the shown works`() {
        work("a", "첫째", 1, author = "윤서하")
        work("b", "둘째", 2)
        work("c", "셋째", 3)
        views(Triple("a", 5, 0), Triple("b", 1, 0))
        likes("a" to 7, "b" to 2)

        val list = service.publicList(null, null, null).items
        assertEquals(listOf("c", "b", "a"), list.map { it.id })
        assertEquals(listOf(0L, 2L, 7L), list.map { it.likes })
        verify(likeService).counts(listOf("c", "b", "a"))

        assertEquals(listOf(7L), service.publicList("첫째", "title", null).items.map { it.likes })
        verify(likeService).counts(listOf("a"))

        val ranked = service.ranking("top").items
        assertEquals(listOf(7L, 2L), ranked.map { it.likes })
        // 좋아요를 얹어도 작가명은 소유자의 Core 닉네임이다(작품 행 author_name을 읽지 않는다).
        assertEquals(listOf("윤서하", "작성자"), ranked.map { it.authorName })
        verify(likeService).counts(listOf("a", "b"))
        assertTrue(list.none { it.liked })
    }

    @Test fun `like sort orders by public likes, breaks ties by newest first and counts the likes once`() {
        work("a", "첫째", 1)
        work("b", "둘째", 2)
        work("c", "셋째", 3)
        work("d", "넷째", 4)
        views(Triple("a", 9, 0))
        likes("a" to 2, "c" to 2, "b" to 5)

        val items = service.publicList(null, null, "like").items

        assertEquals(listOf("b", "c", "a", "d"), items.map { it.id })
        assertEquals(listOf(5L, 2L, 2L, 0L), items.map { it.likes })
        // 조회 수는 좋아요 정렬과 무관하게 응답에 채워진다.
        assertEquals(listOf(0L, 0L, 9L, 0L), items.map { it.views })
        // 정렬에 쓴 묶음 집계를 그대로 채우므로 좋아요 수는 한 번만 센다.
        verify(likeService, times(1)).counts(ArgumentMatchers.anyCollection<String>())
        verify(likeService).counts(listOf("d", "c", "b", "a"))
    }

    @Test fun `like sort applies to the searched works only`() {
        work("a", "달빛 하나", 1)
        work("b", "달빛 둘", 2)
        work("c", "별빛 셋", 3)
        views()
        likes("a" to 1, "b" to 4, "c" to 9)

        assertEquals(listOf("b", "a"), service.publicList("달빛", "title", "like").items.map { it.id })
        verify(likeService).counts(listOf("b", "a"))
    }

    @Test fun `page and size cut the sorted result and both omitted keep the whole list`() {
        for (i in 1..5) work("w$i", "작품 $i", i.toLong())
        views(Triple("w1", 9, 0), Triple("w2", 5, 0))
        likes("w3" to 3, "w1" to 1)

        fun ids(sort: String?, page: String?, size: String?) = service.publicList(null, null, sort, page, size).items.map { it.id }

        assertEquals(listOf("w5", "w4", "w3", "w2", "w1"), ids(null, null, null))
        assertEquals(listOf("w5", "w4"), ids(null, "0", "2"))
        assertEquals(listOf("w3", "w2"), ids(null, "1", "2"))
        assertEquals(listOf("w1"), ids(null, "2", "2"))
        assertEquals(emptyList<String>(), ids(null, "3", "2"))
        // 하나만 오면 나머지는 기본값(page 0, size 20)이다.
        assertEquals(listOf("w5", "w4", "w3"), ids(null, null, "3"))
        assertEquals(listOf("w5", "w4", "w3", "w2", "w1"), ids(null, "0", null))
        assertEquals(emptyList<String>(), ids(null, "1", null))
        // 정렬을 마친 결과에서 자른다.
        assertEquals(listOf("w1", "w2"), ids("view", "0", "2"))
        assertEquals(listOf("w5", "w4"), ids("view", "1", "2"))
        assertEquals(listOf("w3", "w1"), ids("like", "0", "2"))
        assertEquals(listOf("w5", "w4"), ids("like", "1", "2"))
        assertEquals(listOf("w2"), ids("like", "2", "2"))
    }

    @Test fun `a page keeps the likes and views of its own works and counts the likes once`() {
        for (i in 1..5) work("w$i", "작품 $i", i.toLong())
        views(Triple("w4", 7, 0))
        likes("w4" to 3, "w2" to 8)

        val page = service.publicList(null, null, null, "0", "2").items

        assertEquals(listOf("w5", "w4"), page.map { it.id })
        assertEquals(listOf(0L, 3L), page.map { it.likes })
        assertEquals(listOf(0L, 7L), page.map { it.views })
        verify(likeService, times(1)).counts(ArgumentMatchers.anyCollection<String>())
    }

    @Test fun `a bad page or size fails with 422 before any lookup`() {
        val bad = listOf<Pair<String?, String?>>("-1" to null, "abc" to null, "" to null, null to "0", null to "101", null to "abc", "0" to "1.5", "abc" to "10")
        for ((page, size) in bad) assertEquals(422, failure { service.publicList(null, null, null, page, size) }.status, "$page/$size")

        verifyNoInteractions(works, access, viewService, nicknames, likeService)
    }

    @Test fun `public detail fills the like count and whether the signed in member liked it`() {
        work("a", "첫째", 1, author = "윤서하")
        likes("a" to 4)
        `when`(likeService.liked("a", "reader")).thenReturn(true)

        val signedIn = service.publicRead("a", "reader")
        assertEquals(4L, signedIn.likes)
        assertTrue(signedIn.liked)
        assertEquals("윤서하", signedIn.authorName)

        val anonymous = service.publicRead("a")
        assertEquals(4L, anonymous.likes)
        assertFalse(anonymous.liked)
        verify(likeService, times(1)).liked(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
    }

    @Test fun `unknown options fail with 422 before any lookup`() {
        for (call in listOf<() -> Any>({ service.publicList(null, "body", null) }, { service.publicList(null, null, "popular") }, { service.ranking("daily") })) {
            assertEquals(422, failure { call() }.status)
        }

        verifyNoInteractions(works, access, viewService, nicknames, likeService)
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
            "rankings" to { service.rankings("view", null, null, null) },
            "detail" to { service.publicRead("a") },
        )
        for ((name, call) in calls) assertSame(failure, assertThrows(CoreAuthException::class.java) { call() }, name)
    }

    // ---- 기능 45: 기간별 랭킹·인기 추이(rankings). 순수 규칙은 WorkRankingTest가 맡고 여기서는 Service 조립을 본다. ----

    /** [window] 기간의 조회 수다(최근, 그 앞 같은 길이). 하루 기본값은 위 [views]와 같은 대역이다. */
    private fun periodViews(window: Duration, vararg counts: Triple<String, Long, Long>) {
        `when`(viewService.counts(window)).thenReturn(counts.associate { (id, recent, prior) -> id to WorkViews(recent, prior) })
    }
    // 기간 안 새 좋아요 수다. 호출 때 받은 기간 시작은 sinceSeen에 남는다.
    private val sinceSeen = mutableListOf<Instant>()
    private fun newLikes(vararg counts: Pair<String, Long>) {
        `when`(likeService.countsSince(ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH)).thenAnswer { call ->
            sinceSeen += call.getArgument<Instant>(0)
            counts.toMap()
        }
    }
    private fun lastPublished(vararg rows: Pair<String, Instant>) {
        `when`(publication.lastPublished()).thenReturn(rows.toMap())
    }
    private fun rankedIds(kind: String, period: String? = null, type: String? = null, limit: String? = null) =
        service.rankings(kind, period, type, limit).items.map { it.id }

    @Test fun `rankings view ranks the requested period and fills its views and the options it used`() {
        work("a", "첫째", 1)
        work("b", "둘째", 2)
        work("c", "셋째", 3)
        periodViews(Duration.ofDays(7), Triple("a", 5, 0), Triple("b", 9, 1), Triple("c", 0, 4))
        val before = Instant.now()

        val week = service.rankings("view", "week", null, null)

        assertEquals(listOf("b", "a"), week.items.map { it.id })
        assertEquals(listOf(9L, 5L), week.items.map { it.views })
        assertEquals(Triple("view", "week", "all"), Triple(week.kind, week.period, week.type))
        assertFalse(week.computedAt.isBefore(before))
        assertFalse(week.computedAt.isAfter(Instant.now()))
        assertTrue(week.items.all { it.updatedAt == null })
        verify(viewService).counts(Duration.ofDays(7))
    }

    @Test fun `rankings default to the last 24 hours, every work type and ten items`() {
        for (i in 1..12) work("w$i", "작품 $i", i.toLong())
        views(*(1..12).map { Triple("w$it", it.toLong(), 0L) }.toTypedArray())

        val day = service.rankings("view", null, null, null)

        assertEquals((12 downTo 3).map { "w$it" }, day.items.map { it.id })
        assertEquals(Triple("view", "day", "all"), Triple(day.kind, day.period, day.type))
        verify(viewService).counts(Duration.ofHours(24))
    }

    @Test fun `rankings rising compares the period with the same length before it`() {
        work("a", "첫째", 1)
        work("b", "둘째", 2)
        work("c", "셋째", 3)
        periodViews(Duration.ofDays(30), Triple("a", 3, 0), Triple("b", 2, 5), Triple("c", 4, 4))

        assertEquals(listOf("a"), rankedIds("rising", "month"))
        verify(viewService).counts(Duration.ofDays(30))
    }

    @Test fun `rankings popular counts the likes pressed within the period and shows the total public likes`() {
        work("a", "첫째", 1)
        work("b", "둘째", 2)
        work("c", "셋째", 3)
        work("quiet", "좋아요 없음", 4)
        newLikes("a" to 2, "b" to 2, "c" to 1)
        likes("a" to 40, "b" to 30, "c" to 20, "quiet" to 99)
        periodViews(Duration.ofDays(7), Triple("a", 1, 0), Triple("b", 5, 0), Triple("quiet", 50, 0))
        val before = Instant.now()

        val popular = service.rankings("popular", "week", null, null).items

        assertEquals(listOf("b", "a", "c"), popular.map { it.id })
        assertEquals(listOf(30L, 40L, 20L), popular.map { it.likes })
        assertEquals(listOf(5L, 1L, 0L), popular.map { it.views })
        val since = sinceSeen.single()
        assertTrue(since in before.minus(Duration.ofDays(7))..Instant.now().minus(Duration.ofDays(7)), "$since")
        verify(likeService).counts(listOf("b", "a", "c"))
    }

    @Test fun `rankings latest lists the newest public works and checks visibility only as far as the limit needs`() {
        for (i in 1..12) work("w$i", "작품 $i", i.toLong())
        work("draft", "비공개", 13, visible = "private")
        views()

        assertEquals(listOf("w12", "w11", "w10"), rankedIds("latest", limit = "3"))
        assertEquals((12 downTo 3).map { "w$it" }, rankedIds("latest"))
        verify(access, never()).get("w1")
        assertEquals(listOf(0L, 0L, 0L), service.rankings("latest", null, null, "3").items.map { it.views })
    }

    @Test fun `rankings updated orders by the last publication time and fills updatedAt only for that kind`() {
        work("a", "첫째", 1)
        work("b", "둘째", 2)
        work("never", "발행 기록 없음", 3)
        lastPublished("a" to start.plusSeconds(60), "b" to start.plusSeconds(120))
        views(Triple("a", 1, 0))

        val updated = service.rankings("updated", null, null, null).items

        assertEquals(listOf("b", "a"), updated.map { it.id })
        assertEquals(listOf<Instant?>(start.plusSeconds(120), start.plusSeconds(60)), updated.map { it.updatedAt })
        verify(publication, times(1)).lastPublished()
        // 다른 종류는 마지막 발행 시각을 읽지도 채우지도 않는다.
        assertEquals(listOf<Instant?>(null), service.rankings("view", null, null, null).items.map { it.updatedAt })
        verify(publication, times(1)).lastPublished()
    }

    @Test fun `rankings type ranks inside the requested type before taking the limit`() {
        work("o1", "원작 하나", 1)
        work("f1", "포크 하나", 2, fork = true)
        work("o2", "원작 둘", 3)
        work("f2", "포크 둘", 4, fork = true)
        views(Triple("o1", 10, 0), Triple("o2", 9, 0), Triple("f1", 2, 0), Triple("f2", 1, 0))

        assertEquals(listOf("o1", "o2", "f1", "f2"), rankedIds("view"))
        assertEquals(listOf("o1", "o2"), rankedIds("view", type = "original"))
        assertEquals(listOf("f1", "f2"), rankedIds("view", type = "fork"))
        // 전체 1위가 원작이어도 Fork 1개를 요청하면 Fork 1위다(상위 N개를 자른 뒤 거르지 않는다).
        assertEquals(listOf("f1"), rankedIds("view", type = "fork", limit = "1"))
        assertEquals("fork", service.rankings("view", null, "fork", null).type)
        assertEquals(listOf("f2", "f1"), rankedIds("latest", type = "fork"))
    }

    @Test fun `rankings leave out private and restricted works before taking the limit`() {
        work("top", "제한 작품", 1, restricted = true)
        work("mid", "공개 작품", 2)
        work("low", "공개 작품 둘", 3)
        work("draft", "비공개", 4, visible = "private")
        periodViews(Duration.ofHours(24), Triple("top", 99, 0), Triple("mid", 5, 0), Triple("low", 3, 0), Triple("draft", 50, 0))
        lastPublished("top" to start, "mid" to start, "draft" to start)

        assertEquals(listOf("mid"), rankedIds("view", limit = "1"))
        assertEquals(listOf("mid", "low"), rankedIds("view"))
        assertEquals(listOf("mid", "low"), rankedIds("rising"))
        assertEquals(listOf("low", "mid"), rankedIds("latest"))
        assertEquals(listOf("mid"), rankedIds("updated"))
    }

    @Test fun `soft deleted works are left out of list search and every ranking before the limit is taken`() {
        // 삭제 작품(DEC-42, #108)이 모든 점수·최신·발행 순위의 맨 앞이어도 공개 판단(publiclyVisible)에서 빠지고 그 자리는 다음 공개 작품이 채운다.
        work("gone", "삭제 작품", 3, deleted = true)
        work("open", "공개 작품", 2)
        work("also", "공개 작품 둘", 1)
        views(Triple("gone", 99, 0), Triple("open", 5, 0), Triple("also", 3, 0))
        periodViews(Duration.ofHours(24), Triple("gone", 99, 0), Triple("open", 5, 0), Triple("also", 3, 0))
        newLikes("gone" to 9, "open" to 1)
        lastPublished("gone" to start.plusSeconds(100), "open" to start)

        assertEquals(listOf("open", "also"), service.publicList(null, null, null).items.map { it.id })
        assertEquals(listOf("open", "also"), service.publicList("작품", "title", "view").items.map { it.id })
        assertEquals(listOf("open", "also"), service.ranking("top").items.map { it.id })
        assertEquals(listOf("open", "also"), service.ranking("rising").items.map { it.id })
        assertEquals(listOf("open"), rankedIds("view", limit = "1"))
        assertEquals(listOf("open", "also"), rankedIds("rising"))
        assertEquals(listOf("open"), rankedIds("popular"))
        assertEquals(listOf("open"), rankedIds("latest", limit = "1"))
        assertEquals(listOf("open"), rankedIds("updated"))
    }

    @Test fun `rankings take at most the limit and answer an empty catalog without asking Core`() {
        for (i in 1..4) work("w$i", "작품 $i", i.toLong())
        views(*(1..4).map { Triple("w$it", it.toLong(), 0L) }.toTypedArray())

        assertEquals(listOf("w4", "w3"), rankedIds("view", limit = "2"))
        assertEquals(4, rankedIds("view", limit = "50").size)

        rows.clear()
        `when`(works.findAll()).thenReturn(emptyList())
        asked.clear()
        assertEquals(emptyList<String>(), rankedIds("latest"))
        assertTrue(asked.flatten().isEmpty())
    }

    @Test fun `rankings reject unknown options and a bad limit with 422 before any lookup`() {
        val calls = listOf<() -> Any>(
            { service.rankings("top", null, null, null) }, { service.rankings("daily", null, null, null) },
            { service.rankings("view", "year", null, null) }, { service.rankings("view", null, "forks", null) },
            { service.rankings("view", null, null, "0") }, { service.rankings("view", null, null, "51") }, { service.rankings("view", null, null, "x") },
        )
        for (call in calls) assertEquals(422, failure { call() }.status)

        verifyNoInteractions(works, access, viewService, nicknames, likeService, publication)
    }

    @Test fun `rankings ask Core once for the owners of the shown works only`() {
        for (i in 1..4) work("w$i", "작품 $i", i.toLong(), author = "작가 $i")
        views(*(1..4).map { Triple("w$it", it.toLong(), 0L) }.toTypedArray())

        val shown = service.rankings("view", null, null, "2").items

        assertEquals(listOf("작가 4", "작가 3"), shown.map { it.authorName })
        assertEquals(1, asked.size)
        assertEquals(setOf("owner-w4", "owner-w3"), asked.single().toSet())
    }
}
