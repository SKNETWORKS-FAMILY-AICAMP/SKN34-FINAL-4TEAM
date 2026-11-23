package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.contentKey
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.search.service.SearchCandidates
import ai.storyfork.content.publication.service.dto.*
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.world.repository.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Spy
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import java.util.Optional

/**
 * 작품 수정이 장르·해시태그를 선택으로 받는 계약을 DB 없이 검증한다. 생략(null)은 저장된 값 유지, 값이 오면 등록과 같은 규칙으로 검증해 통째로 교체한다.
 * 고를 수 있는 장르는 활성 장르뿐이고 수정은 이미 붙은 장르(숨긴 것 포함)를 그대로 두는 것도 허용한다(DEC-56). 같은 규칙의 작품 등록 쪽도 맨 아래에서 함께 검증한다.
 * 실제 SQL(삭제 뒤 같은 키 재삽입)은 CI의 WorkUpdatePostgresTest가 확인한다.
 */
@ExtendWith(MockitoExtension::class)
class WorkUpdateMetadataServiceTest {
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
    @Mock lateinit var viewService: WorkViewService
    @Mock lateinit var nicknames: ai.storyfork.content.auth.service.CoreNicknameService
    @Mock lateinit var likeService: WorkLikeService
    @Mock lateinit var schedules: PublicationScheduleRepository
    // 검색 색인이 없는 경로다(이 테스트는 검색을 보지 않는다).
    @Spy var search = SearchCandidates(null)
    @InjectMocks lateinit var service: WorkService

    private val work=WorkAccessResult("w","owner","제목","소개",4,"world","private",false,false,null)
    private val row=WorkEntity(id="w",ownerId="owner",title="제목",description="소개",revision=4)
    private val fantasy=GenreEntity("genre-01","genre-01","판타지")
    private val sf=GenreEntity("genre-14","genre-14","SF")
    /** 운영자가 숨긴 SF다. 이미 붙은 작품은 그대로 두고 새로 붙이는 것만 막는다(DEC-56). */
    private val hiddenSf=GenreEntity("genre-14","genre-14","SF",active=false)
    private fun active(vararg rows: GenreEntity) { `when`(genreRows.findActive()).thenReturn(rows.toList()) }
    private fun own(w: WorkAccessResult = work) { `when`(access.own("w","owner")).thenReturn(w) }
    /** 수정 뒤 응답을 만드는 읽기 경로가 쓰는 대역이다(검증에 실패하는 테스트는 여기까지 오지 않는다). */
    private fun response() {
        `when`(works.findById("w")).thenReturn(Optional.of(row))
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(emptyList()))
    }
    private fun update(genres: List<String>? = null,hashtags: List<String>? = null,revision: Int = 4) =
        service.update("w","owner",UpdateWorkRequest("새 제목","새 소개",revision,genres,hashtags))
    private fun calls(mock: Any) = mockingDetails(mock).invocations.map {it.method.name}
    private fun written(mock: Any,method: String) = mockingDetails(mock).invocations.filter {it.method.name==method}
    private fun rejected(data: UpdateWorkRequest) = assertThrows(ContentFailure::class.java) {service.update("w","owner",data)}

    @Test fun `request body without genres and hashtags keeps them while an empty array is a real value`() {
        val mapper=tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        val sparse=mapper.readValue("""{"title":"제목","summary":"소개","revision":4}""",UpdateWorkRequest::class.java)
        assertNull(sparse.genres)
        assertNull(sparse.hashtags)
        assertEquals(UpdateWorkRequest("제목","소개",4),sparse)
        val sent=mapper.readValue("""{"title":"제목","revision":4,"genres":["판타지"],"hashtags":[]}""",UpdateWorkRequest::class.java)
        assertEquals(listOf("판타지"),sent.genres)
        assertEquals(emptyList<String>(),sent.hashtags)
    }

    @Test fun `omitting genres and hashtags changes only the title and summary`() {
        own();response()
        update()
        assertEquals(listOf("새 제목","새 소개",5),listOf(row.title,row.description,row.revision))
        assertTrue(calls(workGenres).none {it=="deleteAllByWorkId" || it=="saveAll"})
        assertTrue(calls(hashtagRows).none {it=="deleteAllByWorkId" || it=="saveAll"})
        verify(genreRows,never()).findActive()
    }

    @Test fun `genres replace the stored genres by deleting first and flushing before the insert`() {
        own();response();active(fantasy,sf)
        update(genres=listOf("SF","판타지"))
        // Hibernate는 insert를 delete보다 먼저 보내므로, 같은 (작품, 장르)를 다시 넣으려면 삭제를 먼저 내보내야 한다.
        assertEquals(listOf("deleteAllByWorkId","flush","saveAll"),calls(workGenres).filter {it in setOf("deleteAllByWorkId","flush","saveAll")})
        verify(workGenres).deleteAllByWorkId("w")
        val saved=written(workGenres,"saveAll").single().getArgument<Iterable<WorkGenreEntity>>(0).toList()
        assertEquals(setOf("genre-01","genre-14"),saved.map {it.genreId}.toSet())
        assertTrue(saved.all {it.workId=="w"})
        assertEquals(listOf("새 제목",5),listOf(row.title,row.revision))
        assertTrue(calls(hashtagRows).none {it=="deleteAllByWorkId" || it=="saveAll"})
    }

    @Test fun `hashtags replace the stored hashtags with trimmed ones numbered from zero`() {
        own();response()
        update(hashtags=listOf("  회귀 ","먼치킨"))
        assertEquals(listOf("deleteAllByWorkId","flush","saveAll"),calls(hashtagRows).filter {it in setOf("deleteAllByWorkId","flush","saveAll")})
        verify(hashtagRows).deleteAllByWorkId("w")
        val saved=written(hashtagRows,"saveAll").single().getArgument<Iterable<WorkHashtagEntity>>(0).toList()
        assertEquals(listOf(Triple("회귀",0,contentKey("work-hashtag","w","0")),Triple("먼치킨",1,contentKey("work-hashtag","w","1"))),
            saved.map {Triple(it.tag,it.position,it.id)})
        assertTrue(saved.all {it.workId=="w"})
        assertTrue(calls(workGenres).none {it=="deleteAllByWorkId" || it=="saveAll"})
        verify(genreRows,never()).findActive()
    }

    @Test fun `an empty hashtag list removes every stored hashtag`() {
        own();response()
        update(hashtags=emptyList())
        verify(hashtagRows).deleteAllByWorkId("w")
        assertTrue(written(hashtagRows,"saveAll").flatMap {it.getArgument<Iterable<*>>(0).toList()}.isEmpty())
    }

    @Test fun `the owner of a Fork may change genres and hashtags too`() {
        own(work.copy(source=ai.storyfork.content.fork.service.dto.SourceResponse("original","원작",1,1,"분기")));response();active(fantasy,sf)
        update(genres=listOf("SF"),hashtags=listOf("분기"))
        verify(workGenres).deleteAllByWorkId("w")
        verify(hashtagRows).deleteAllByWorkId("w")
    }

    @Test fun `invalid hashtags are 422 before any repository is touched`() {
        own()
        val cases=listOf(
            UpdateWorkRequest("새 제목","새 소개",4,hashtags=(1..11).map {"태그$it"}),
            UpdateWorkRequest("새 제목","새 소개",4,hashtags=listOf("회귀","  ")),
            // 장르가 맞아도 해시태그가 어긋나면 장르도 바꾸지 않는다.
            UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("판타지"),hashtags=listOf("  ")),
        )
        cases.forEachIndexed {i,data -> assertEquals(422,rejected(data).status,"case $i")}
        // 해시태그 검증은 어떤 저장소 조회보다 먼저다. 장르 행 조회에도 닿지 않아야 위 마지막 경우의 422가 해시태그 때문임을 보장한다.
        verifyNoInteractions(genreRows,workGenres,hashtagRows,works)
    }

    @Test fun `a bad genre count or a duplicate is 422 and nothing is written`() {
        own();active(fantasy,sf)
        listOf(emptyList(),listOf("판타지","SF","무협"),listOf("판타지","판타지")).forEachIndexed {i,genres ->
            assertEquals(422,rejected(UpdateWorkRequest("새 제목","새 소개",4,genres=genres)).status,"case $i")
        }
        verify(workGenres,never()).deleteAllByWorkId("w")
        verify(workGenres,never()).saveAll(org.mockito.ArgumentMatchers.anyIterable())
        verifyNoInteractions(hashtagRows,works)
    }

    @Test fun `a genre that is unknown or hidden and not already on the work is 422 and nothing is written`() {
        own();active(fantasy)
        // SF는 숨겼고 이 작품에 붙어 있지 않다. 없는 이름은 활성 목록에도 없다.
        assertEquals(422,rejected(UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("판타지","SF"))).status)
        assertEquals(422,rejected(UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("없는장르"))).status)
        verify(workGenres,never()).deleteAllByWorkId("w")
        verify(workGenres,never()).saveAll(org.mockito.ArgumentMatchers.anyIterable())
        verifyNoInteractions(hashtagRows,works)
    }

    @Test fun `a hidden genre already on the work is kept while a new active genre is added`() {
        own();response();active(fantasy)
        // 이 작품에는 숨긴 SF가 붙어 있다. 저장할 때 SF를 그대로 두면 통과하고 활성 판타지를 더할 수 있다.
        `when`(workGenres.findAllByWorkId("w")).thenReturn(listOf(WorkGenreEntity("w","genre-14")))
        `when`(genreRows.findAllById(listOf("genre-14"))).thenReturn(listOf(hiddenSf))
        update(genres=listOf("SF","판타지"))
        val saved=written(workGenres,"saveAll").single().getArgument<Iterable<WorkGenreEntity>>(0).toList()
        assertEquals(setOf("genre-01","genre-14"),saved.map {it.genreId}.toSet())
        verify(workGenres).deleteAllByWorkId("w")
    }

    @Test fun `a stale revision is 409 before any genre or hashtag is touched`() {
        own()
        doThrow(ContentFailure(409,"변경됨")).`when`(access).requireRevision(work,3)
        assertEquals(409,rejected(UpdateWorkRequest("새 제목","새 소개",3,genres=listOf("판타지"),hashtags=listOf("회귀"))).status)
        verifyNoInteractions(genreRows,workGenres,hashtagRows,works)
    }

    @Test fun `another owner is 404 before any genre or hashtag is touched`() {
        `when`(access.own("w","intruder")).thenThrow(ContentFailure(404,"찾을 수 없어요"))
        val failure=assertThrows(ContentFailure::class.java) {service.update("w","intruder",UpdateWorkRequest("탈취","소개",4,genres=listOf("판타지")))}
        assertEquals(404,failure.status)
        verifyNoInteractions(genreRows,workGenres,hashtagRows,works)
    }

    // --- 작품 등록의 장르(DEC-56): 고를 수 있는 것은 활성 장르뿐이다 ---
    private fun register(genres: List<String>,type: String? = "ORIGINAL") = service.create("owner",CreateWorkRequest("새 작품","소개",type,genres,emptyList(),true))
    /** 등록 뒤 응답을 만드는 읽기 경로 대역이다(작품 id는 서버가 새로 만든다). */
    private fun created() {
        response()
        // 첫 회차를 만든 뒤 그 id로 초안을 만들기 때문에 저장소 대역이 받은 행을 그대로 돌려준다.
        `when`(episodes.saveAndFlush(org.mockito.ArgumentMatchers.any())).thenAnswer { it.arguments[0] }
        `when`(access.own(org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.eq("owner") ?: "owner")).thenReturn(work)
    }

    @Test fun `a registration links the chosen active genres and nothing else`() {
        created();active(fantasy,sf)
        register(listOf("SF"))
        val saved=written(workGenres,"saveAll").single().getArgument<Iterable<WorkGenreEntity>>(0).toList()
        assertEquals(listOf("genre-14"),saved.map {it.genreId})
        verify(genreRows,times(1)).findActive()
    }

    @Test fun `a hidden or unknown genre is 422 and nothing is created`() {
        active(fantasy)
        // SF는 숨겼다(활성 목록에 없음). 작품에는 아직 붙은 장르가 없어 유지 허용도 없다.
        assertEquals(422,assertThrows(ContentFailure::class.java) {register(listOf("SF"))}.status)
        assertEquals(422,assertThrows(ContentFailure::class.java) {register(listOf("판타지","없는장르"))}.status)
        verifyNoInteractions(members,works,worlds,workGenres,hashtagRows)
    }

    @Test fun `a bad genre count, a duplicate or an unknown type is 422 and nothing is created`() {
        listOf(emptyList(),listOf("판타지","SF","무협"),listOf("판타지","판타지")).forEach {
            assertEquals(422,assertThrows(ContentFailure::class.java) {register(it)}.status)
        }
        assertEquals(422,assertThrows(ContentFailure::class.java) {register(listOf("판타지"),type=null)}.status)
        verifyNoInteractions(members,works,worlds,workGenres,hashtagRows)
    }

    @Test fun `a work created without registration metadata reads no genre`() {
        created()
        service.create("owner",CreateWorkRequest("새 작품","소개"))
        verify(genreRows,never()).findActive()
        assertTrue(written(workGenres,"saveAll").isEmpty())
    }
}
