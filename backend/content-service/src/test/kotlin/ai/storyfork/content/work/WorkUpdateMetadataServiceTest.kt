package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.contentKey
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
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
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import java.util.Optional

/**
 * 작품 수정이 장르·해시태그를 선택으로 받는 계약을 DB 없이 검증한다. 생략(null)은 저장된 값 유지, 값이 오면 등록과 같은 규칙으로 검증해 통째로 교체한다.
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
    @InjectMocks lateinit var service: WorkService

    private val work=WorkAccessResult("w","owner","제목","소개",4,"world","private",false,false,null)
    private val row=WorkEntity(id="w",ownerId="owner",title="제목",description="소개",revision=4)
    private val fantasy=GenreEntity("genre-01","genre-01","판타지")
    private val sf=GenreEntity("genre-14","genre-14","SF")
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
        verify(genreRows,never()).findAllByNameIn(org.mockito.ArgumentMatchers.anyCollection())
    }

    @Test fun `genres replace the stored genres by deleting first and flushing before the insert`() {
        own();response()
        `when`(genreRows.findAllByNameIn(listOf("SF","판타지"))).thenReturn(listOf(fantasy,sf))
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
        verify(genreRows,never()).findAllByNameIn(org.mockito.ArgumentMatchers.anyCollection())
    }

    @Test fun `an empty hashtag list removes every stored hashtag`() {
        own();response()
        update(hashtags=emptyList())
        verify(hashtagRows).deleteAllByWorkId("w")
        assertTrue(written(hashtagRows,"saveAll").flatMap {it.getArgument<Iterable<*>>(0).toList()}.isEmpty())
    }

    @Test fun `the owner of a Fork may change genres and hashtags too`() {
        own(work.copy(source=ai.storyfork.content.fork.service.dto.SourceResponse("original","원작",1,1,"분기")));response()
        `when`(genreRows.findAllByNameIn(listOf("SF"))).thenReturn(listOf(sf))
        update(genres=listOf("SF"),hashtags=listOf("분기"))
        verify(workGenres).deleteAllByWorkId("w")
        verify(hashtagRows).deleteAllByWorkId("w")
    }

    @Test fun `invalid genres or hashtags are 422 and nothing is written`() {
        own()
        val cases=listOf(
            UpdateWorkRequest("새 제목","새 소개",4,genres=emptyList()),
            UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("판타지","SF","무협")),
            UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("없는장르")),
            UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("판타지","판타지")),
            UpdateWorkRequest("새 제목","새 소개",4,hashtags=(1..11).map {"태그$it"}),
            UpdateWorkRequest("새 제목","새 소개",4,hashtags=listOf("회귀","  ")),
            // 장르가 맞아도 해시태그가 어긋나면 장르도 바꾸지 않는다.
            UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("판타지"),hashtags=listOf("  ")),
        )
        cases.forEachIndexed {i,data -> assertEquals(422,rejected(data).status,"case $i")}
        // 입력 검증은 어떤 저장소 조회보다 먼저다. 장르 행 조회에도 닿지 않아야 위 마지막 경우의 422가 해시태그 때문임을 보장한다.
        verifyNoInteractions(genreRows,workGenres,hashtagRows,works)
    }

    @Test fun `a genre the database does not know is 422 and nothing is written`() {
        own()
        `when`(genreRows.findAllByNameIn(listOf("판타지","SF"))).thenReturn(listOf(fantasy))
        assertEquals(422,rejected(UpdateWorkRequest("새 제목","새 소개",4,genres=listOf("판타지","SF"))).status)
        verifyNoInteractions(workGenres,hashtagRows,works)
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
}
