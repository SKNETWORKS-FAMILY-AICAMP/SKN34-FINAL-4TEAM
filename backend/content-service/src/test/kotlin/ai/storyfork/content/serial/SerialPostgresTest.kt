package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.ScheduledMemberPayload
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.service.CoreCreditService
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.serial.client.GeneratedChoices
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.client.SerialAiClient
import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.client.SerialScene
import ai.storyfork.content.serial.domain.KST
import ai.storyfork.content.serial.service.SerialRunner
import ai.storyfork.content.serial.service.SerialService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.math.BigDecimal
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * AI 자율 연재의 HTTP 계약(경로·Security·CSRF·상태 코드·코드값)과 V43 저장(AI 4지선다·제안 게시판)·선택지 생성·실행을 실제 PostgreSQL로 검증한다. Core(회원 확인·닉네임·크레딧)와 AI는 대역이고
 * 일정 점검은 [runner]를 직접 불러 한 번 돌린다(앱의 1분 스케줄러가 먼저 가져가도 같은 결과라 상태가 바뀔 때까지 기다린다).
 * TEST_CONTENT_DATABASE_URL이 있을 때만 실행하며, DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 행만 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class SerialPostgresTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @MockitoBean lateinit var credits: CoreCreditService
    @MockitoBean lateinit var ai: SerialAiClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var runner: SerialRunner
    @Autowired lateinit var serial: SerialService
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    // 앱의 1분 스케줄러 스레드가 먼저 실행해도 같은 목록에 쌓이므로 스레드 안전한 목록이다.
    private val episodeRequests=java.util.concurrent.CopyOnWriteArrayList<Map<*,*>>()
    private val generated=GeneratedEpisode("독자들은 재회를 원했다.","2화 제목","2화 본문",BigDecimal("1.5"))
    private val choiceTexts=listOf("두 사람이 다시 만난다","편지가 도착한다","오래된 문이 열린다","비밀이 밝혀진다")
    // 오늘이 아닌 요일만 고르면 일정이 도래하지 않아(시각과 무관하게) 테스트가 지금 실행(queued)으로만 움직인다.
    private val notToday get()=LocalDate.now(KST).plusDays(1).dayOfWeek.name.take(3)
    // 요청의 enabled는 서버가 무시한다(켜기·끄기는 운영 설정의 집필 방식). 일부러 true를 실어 보낸다.
    private val schedule get()="""{"enabled":true,"days":["$notToday"],"time":"21:00","direction":"따뜻한 분위기로"}"""
    // 집필 방식을 autonomous로 저장하면 AI 자율 집필이 켜진다(새 작품은 저장한 적이 없어 revision 0).
    private fun autonomous(owner: UUID,path: String,revision: Int = 0)=call("PUT","$path/operating-settings",owner,"""{"revision":$revision,"writingMode":"autonomous"}""")

    @BeforeEach fun stubs() {
        episodeRequests.clear()
        // 공유 DB에 앞선 실행이 남긴 실행 요청(queued·running)과 켜진 연재는 이 테스트의 tick이 함께 집어 AI 요청이 섞이므로 먼저 닫는다(serial 표는 이 테스트만 쓴다).
        jdbc.update("UPDATE serial_board SET status='failed', failure_reason='테스트 정리', closed_at=coalesce(closed_at, now()) WHERE status IN ('queued','running')")
        jdbc.update("UPDATE ai_serial SET enabled=false WHERE enabled")
        `when`(credits.reserve(ArgumentMatchers.anyString(),ArgumentMatchers.anyString(),ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ONE)).thenReturn("res-1")
        `when`(ai.episode(ArgumentMatchers.anyMap<String,Any?>())).thenAnswer { call -> episodeRequests.add(call.arguments[0] as Map<*,*>); generated }
        `when`(ai.simulate(ArgumentMatchers.anyMap<String,Any?>())).thenReturn(SerialScene("달빛이 비치는 복도였다.",BigDecimal("0.4")))
        `when`(ai.choices(ArgumentMatchers.anyMap<String,Any?>())).thenReturn(GeneratedChoices(choiceTexts,BigDecimal("0.2")))
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call -> (call.arguments[0] as Collection<*>).associate { it as String to "회원" } }
    }

    private fun member(): UUID=UUID.randomUUID().also {id ->
        `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
    }
    private fun call(method: String,path: String,member: UUID? = null,body: String? = null,csrf: Boolean = true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
            .method(method,if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        if(body!=null) request.header("Content-Type","application/json")
        if(method!="GET" && csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun node(response: HttpResponse<String>): JsonNode=json.readTree(response.body())
    private fun code(response: HttpResponse<String>)=node(response).path("code").asString()
    private fun ids(view: JsonNode)=view.path("proposals").values().map {it.path("id").asString()}
    private fun votes(view: JsonNode)=view.path("choices").values().map {it.path("votes").asInt()}
    private fun choiceCount(work: String)=count("SELECT count(*) FROM serial_choice c JOIN serial_board b ON b.id=c.board_id WHERE b.work_id=?",work)
    private fun count(sql: String,vararg args: Any)=jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun created(response: HttpResponse<String>): String {
        assertEquals(201,response.statusCode(),response.body())
        return node(response).path("id").asString()
    }
    private fun statuses(work: String)=jdbc.queryForList("SELECT status FROM serial_board WHERE work_id=? ORDER BY opened_at, id",String::class.java,work).filterNotNull()
    private fun await(what: String,check: () -> Boolean) {
        val deadline=System.currentTimeMillis()+30_000
        while(System.currentTimeMillis()<deadline) {
            if(check()) return
            Thread.sleep(200)
        }
        throw AssertionError("timeout waiting for $what")
    }

    /** 1화를 발행한 공개 작품이다(발행이 다음 회차의 빈 초안을 만든다). Core는 일정 발행의 회원 확인도 이 회원으로 답한다. */
    private fun work(owner: UUID): String {
        val id=works.create(owner.toString(),CreateWorkRequest("연재 테스트","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        val draft=driver.edit(id,owner.toString(),DraftRequest("1화","본문",0))
        driver.publish(id,owner.toString(),PublishRequest(draft.revision,true,true,true,driver.history(id,owner.toString()).versions.last().id))
        `when`(core.verifyScheduledMember(ScheduledMemberPayload(owner.toString()))).thenReturn(VerifiedMemberResponse(owner))
        return id
    }

    @Test fun `an owner turns it on the check makes four choices readers vote and propose and the run publishes the next episode and opens the next board`() {
        val owner=member(); val one=member(); val two=member(); val poor=member(); val stranger=member()
        val id=work(owner)
        val path="/api/v1/works/$id"

        // 설정: 저장한 적이 없으면 꺼짐 기본값 200, 소유자만 읽고 남은 404·비로그인 401이며 꺼져 있으면 지금 실행은 409 SERIAL_DISABLED다.
        val initial=call("GET","$path/ai-serial",owner)
        assertEquals(200,initial.statusCode(),initial.body())
        assertEquals(listOf<Any?>(false,"21:00",0,""),node(initial).let {listOf(it.path("enabled").asBoolean(),it.path("time").asString(),it.path("days").size(),it.path("direction").asString())})
        assertEquals(404,call("GET","$path/ai-serial",stranger).statusCode())
        assertEquals(401,call("GET","$path/ai-serial").statusCode())
        val off=call("POST","$path/ai-serial/run",owner)
        assertEquals(409,off.statusCode()); assertEquals("SERIAL_DISABLED",code(off))

        // 켜기 전에는 열린 게시판이 없고(익명도 200으로 읽는다), 잘못된 일정은 422, CSRF 없음은 403, 남의 작품은 404다.
        val closed=call("GET","$path/serial-board")
        assertEquals(200,closed.statusCode(),closed.body())
        assertTrue(node(closed).path("board").isNull)
        assertEquals(422,call("PUT","$path/ai-serial",owner,"""{"days":[],"time":"21:00","direction":""}""").statusCode())
        assertEquals(403,call("PUT","$path/ai-serial",owner,schedule,csrf=false).statusCode())
        assertEquals(404,call("PUT","$path/ai-serial",stranger,schedule).statusCode())

        // 일정만 저장하면 요청의 enabled(true)를 무시해 꺼진 채이고 게시판도 열리지 않는다.
        val scheduled=call("PUT","$path/ai-serial",owner,schedule)
        assertEquals(200,scheduled.statusCode(),scheduled.body())
        assertEquals(listOf(false,"21:00"),node(scheduled).let {listOf(it.path("enabled").asBoolean(),it.path("time").asString())})
        assertTrue(statuses(id).isEmpty())

        // 집필 방식을 autonomous로 저장하면 켜지고 마지막 발행 회차+1(2화)의 게시판이 열린다. 세계관 연결은 필요 없다.
        val mode=autonomous(owner,path)
        assertEquals(200,mode.statusCode(),mode.body())
        assertEquals("autonomous",node(mode).path("current").path("writingMode").asString())
        assertTrue(node(call("GET","$path/ai-serial",owner)).path("enabled").asBoolean())
        val board=node(call("GET","$path/serial-board")).path("board")
        assertEquals(2,board.path("episodeNumber").asInt())
        val boardId=board.path("id").asString()
        assertEquals(listOf("open"),statuses(id))

        // 켜진 직후 화면에는 제안 글이 없다(선택지는 앱 스케줄러가 먼저 만들었을 수 있어 개수를 단언하지 않는다): enabled는 true다.
        val fresh=node(call("GET","$path/serial-board"))
        assertTrue(fresh.path("enabled").asBoolean())
        assertEquals(0,fresh.path("proposals").size())

        // 1분 점검이 선택지 4개를 만든다: 소유자 크레딧 예약 → AI → 저장 → 정산(serial-choice 키). 번호 1~4다.
        runner.tick()
        await("the four choices") {choiceCount(id)==4}
        val choices=node(call("GET","$path/serial-board")).path("choices")
        assertEquals(listOf(1,2,3,4),choices.values().map {it.path("position").asInt()})
        assertEquals(choiceTexts,choices.values().map {it.path("text").asString()})
        val c=choices.values().map {it.path("id").asString()}
        verify(credits,timeout(30_000)).settle(ArgumentMatchers.eq(owner.toString()) ?: "",ArgumentMatchers.startsWith("serial-choice:$boardId:") ?: "",ArgumentMatchers.eq(BigDecimal("0.2")) ?: BigDecimal.ONE)

        // 제안 게시판: 글은 회원마다 개수 제한 없이 쓰고(201 {id}), 비로그인은 401, 잘못된 입력은 422다.
        val firstId=created(call("POST","$path/serial-board/proposals",one,"""{"kind":"general","title":"재회 장면","body":"두 사람이 다시 만나면 좋겠어요"}"""))
        val secondId=created(call("POST","$path/serial-board/proposals",one,"""{"kind":"general","title":"또 쓰기","body":"같은 회원이 한 번 더 쓴다"}"""))
        assertEquals(401,call("POST","$path/serial-board/proposals",null,"""{"kind":"general","title":"익명","body":"익명"}""").statusCode())
        assertEquals(422,call("POST","$path/serial-board/proposals",stranger,"""{"kind":"setting","title":"카드 제안","body":"x"}""").statusCode())
        assertEquals(422,call("POST","$path/serial-board/proposals",stranger,"""{"kind":"general","title":"","body":"제목 없음"}""").statusCode())

        // 시뮬레이션 글은 작성자 크레딧으로 예약 → AI 장면 → 저장 → 실제 사용량 정산이다. 크레딧이 모자라면 409 INSUFFICIENT_CREDIT이고 저장되지 않는다.
        val simId=created(call("POST","$path/serial-board/proposals",two,"""{"kind":"simulation","title":"폐교 장면","body":"","simulation":{"premise":"폐교에서 마주친다","beats":["문이 열린다"]}}"""))
        verify(credits).settle(ArgumentMatchers.eq(two.toString()) ?: "",ArgumentMatchers.startsWith("serial-sim:") ?: "",ArgumentMatchers.eq(BigDecimal("0.4")) ?: BigDecimal.ONE)
        doThrow(ContentFailure(409,"크레딧이 부족합니다.","INSUFFICIENT_CREDIT")).`when`(credits).reserve(ArgumentMatchers.eq(poor.toString()) ?: "",ArgumentMatchers.anyString(),ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ONE)
        val broke=call("POST","$path/serial-board/proposals",poor,"""{"kind":"simulation","title":"전제만","body":"","simulation":{"premise":"전제","beats":[]}}""")
        assertEquals(409,broke.statusCode()); assertEquals("INSUFFICIENT_CREDIT",code(broke))
        assertEquals(0,count("SELECT count(*) FROM serial_proposal WHERE author_id=?",poor.toString()))

        // 투표: 한 회원은 한 표이고 선택지 번호순은 그대로다. 옮기기·취소가 되고 없는 선택지는 404, 비로그인은 401이다.
        assertEquals(204,call("PUT","$path/serial-board/vote",one,"""{"choiceId":"${c[2]}"}""").statusCode())
        assertEquals(204,call("PUT","$path/serial-board/vote",two,"""{"choiceId":"${c[2]}"}""").statusCode())
        assertEquals(404,call("PUT","$path/serial-board/vote",two,"""{"choiceId":"unknown"}""").statusCode())
        assertEquals(401,call("PUT","$path/serial-board/vote",null,"""{"choiceId":"${c[0]}"}""").statusCode())
        val voted=node(call("GET","$path/serial-board",one))
        assertEquals(listOf(0,0,2,0),votes(voted))
        assertEquals(c[2],voted.path("myChoiceId").asString())
        assertEquals(204,call("PUT","$path/serial-board/vote",one,"""{"choiceId":"${c[1]}"}""").statusCode())
        assertEquals(204,call("DELETE","$path/serial-board/vote",two).statusCode())
        assertEquals(1,count("SELECT count(*) FROM serial_vote WHERE board_id=?",boardId))
        assertEquals(listOf(0,1,0,0),votes(node(call("GET","$path/serial-board"))))

        // 추천: 글마다 회원당 한 번(되풀이해도 한 행)이고 취소가 되며 없는 글은 404, 비로그인은 401이다. 목록은 최신순이다.
        assertEquals(204,call("PUT","$path/serial-board/proposals/$simId/like",one).statusCode())
        assertEquals(204,call("PUT","$path/serial-board/proposals/$simId/like",one).statusCode())
        assertEquals(204,call("PUT","$path/serial-board/proposals/$simId/like",two).statusCode())
        assertEquals(204,call("PUT","$path/serial-board/proposals/$firstId/like",two).statusCode())
        assertEquals(204,call("DELETE","$path/serial-board/proposals/$firstId/like",two).statusCode())
        assertEquals(404,call("PUT","$path/serial-board/proposals/unknown/like",one).statusCode())
        assertEquals(401,call("PUT","$path/serial-board/proposals/$simId/like").statusCode())
        assertEquals(2,count("SELECT count(*) FROM serial_proposal_like WHERE proposal_id=?",simId))
        val liked=node(call("GET","$path/serial-board",one))
        val rows=liked.path("proposals").values().toList()
        assertEquals(listOf(simId,secondId,firstId),rows.map {it.path("id").asString()})
        assertEquals(listOf(2,0,0),rows.map {it.path("likes").asInt()})
        assertEquals(listOf(true,false,false),rows.map {it.path("likedByMe").asBoolean()})
        assertEquals(listOf(false,true,true),rows.map {it.path("mine").asBoolean()})
        assertEquals("달빛이 비치는 복도였다.",rows[0].path("simulation").path("scene").asString())

        // 소유자만 제안 글을 숨기고(남은 404), 숨긴 글은 목록에서 빠지며 더는 추천할 수 없다.
        assertEquals(404,call("POST","$path/serial-board/proposals/$secondId/hide",one).statusCode())
        assertEquals(204,call("POST","$path/serial-board/proposals/$secondId/hide",owner).statusCode())
        assertEquals(listOf(simId,firstId),ids(node(call("GET","$path/serial-board",one))))
        assertEquals(404,call("PUT","$path/serial-board/proposals/$secondId/like",one).statusCode())

        // 지금 실행: 202 본문 없음 → 일정 점검이 선점해 AI로 회차를 만들고 소유자 명의로 저장·발행한 뒤 정산하고 다음 게시판을 연다.
        val run=call("POST","$path/ai-serial/run",owner)
        assertEquals(202,run.statusCode(),run.body())
        assertEquals("",run.body())
        runner.tick()
        await("the board to be published") {"published" in statuses(id)}
        assertEquals(listOf("published","open"),statuses(id))
        val records=node(call("GET","$path/ai-serial/boards",owner))
        assertTrue(records.isArray)
        assertEquals(listOf("open","published"),records.values().map {it.path("status").asString()})
        assertEquals(listOf(3,2),records.values().map {it.path("episodeNumber").asInt()})
        assertEquals(2,records[1].path("publishedEpisodeNumber").asInt())
        assertTrue(records[1].path("closedAt").isString)
        val pub=node(call("GET","/api/v1/public/works/$id")).path("episodes").values().first {it.path("number").asInt()==2}
        assertEquals(listOf("2화 제목","2화 본문"),listOf(pub.path("title").asString(),pub.path("body").asString()))
        val next=node(call("GET","$path/serial-board"))
        assertEquals(listOf<Any?>(3,"독자들은 재회를 원했다.",0),listOf(next.path("board").path("episodeNumber").asInt(),next.path("summary").asString(),next.path("proposals").size()))
        verify(credits).reserve(ArgumentMatchers.eq(owner.toString()) ?: "",ArgumentMatchers.eq("serial-run:$boardId") ?: "",ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ONE)
        // 정산은 발행 뒤다: 앱 스케줄러가 먼저 선점했다면 published를 본 시점에 아직 부르기 전일 수 있어 기다린다.
        verify(credits,timeout(30_000)).settle(ArgumentMatchers.eq(owner.toString()) ?: "",ArgumentMatchers.eq("serial-run:$boardId") ?: "",ArgumentMatchers.eq(BigDecimal("1.5")) ?: BigDecimal.ONE)

        // AI에는 방향·1위 선택지(득표 포함)·추천 상위 제안 글(숨긴 글 제외, 추천 많은 순, 시뮬레이션 장면 포함)·문맥·상한·예약 id를 보냈다.
        val request=episodeRequests.single()
        assertEquals(listOf<Any?>(id,2,"따뜻한 분위기로","res-1"),listOf(request["workId"],request["episodeNumber"],request["direction"],request["creditReservationId"]))
        assertEquals(mapOf("text" to choiceTexts[1],"votes" to 1),request["choice"])
        val sent=request["proposals"] as List<*>
        assertEquals(listOf("폐교 장면","재회 장면"),sent.map {(it as Map<*,*>)["title"]})
        assertEquals(listOf(2,0),sent.map {(it as Map<*,*>)["likes"]})
        assertEquals(listOf<Any?>("달빛이 비치는 복도였다.",null),sent.map {(it as Map<*,*>)["scene"]})
        assertTrue((request["context"] as String).contains("1화"))
    }

    @Test fun `a failed run is recorded with its fixed reason and reopens the same episode with the choices votes and proposals so the owner can retry`() {
        val owner=member(); val reader=member()
        val id=work(owner)
        val path="/api/v1/works/$id"
        assertEquals(200,autonomous(owner,path).statusCode())
        runner.tick()
        await("the four choices") {choiceCount(id)==4}
        val choice=node(call("GET","$path/serial-board",reader)).path("choices")[2].path("id").asString()
        assertEquals(204,call("PUT","$path/serial-board/vote",reader,"""{"choiceId":"$choice"}""").statusCode())
        val proposal=created(call("POST","$path/serial-board/proposals",reader,"""{"kind":"general","title":"재회","body":"두 사람이 다시 만나면 좋겠어요"}"""))
        assertEquals(204,call("PUT","$path/serial-board/proposals/$proposal/like",reader).statusCode())

        // 검수를 통과하지 못한 실행: 예약은 풀리고 게시판은 failed와 고정 사유로 남으며 아무것도 발행되지 않는다.
        // 이미 스텁한 mock은 when(...) 안의 호출이 기존 답을 먼저 부르므로(기록용 답은 빈 요청을 남기고 던지는 답은 던진다) doThrow·doAnswer로 다시 건다.
        doThrow(SerialAiFailure(reviewFailed=true)).`when`(ai).episode(ArgumentMatchers.anyMap<String,Any?>())
        assertEquals(202,call("POST","$path/ai-serial/run",owner).statusCode())
        runner.tick()
        await("the board to fail") {"failed" in statuses(id)}
        assertEquals(listOf("failed","open"),statuses(id))
        val failedId=jdbc.queryForObject("SELECT id FROM serial_board WHERE work_id=? AND status='failed'",String::class.java,id)!!
        verify(credits).release(ArgumentMatchers.eq(owner.toString()) ?: "",ArgumentMatchers.eq("serial-run:$failedId") ?: "")
        verify(credits,never()).settle(ArgumentMatchers.eq(owner.toString()) ?: "",ArgumentMatchers.eq("serial-run:$failedId") ?: "",ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ONE)
        val records=node(call("GET","$path/ai-serial/boards",owner)).values().toList()
        assertEquals(listOf("open","failed"),records.map {it.path("status").asString()})
        assertEquals("검수를 통과하지 못했습니다.",records[1].path("failureReason").asString())
        assertEquals(listOf(2,2),records.map {it.path("episodeNumber").asInt()})
        assertEquals(1,count("SELECT count(*) FROM episode_current WHERE work_id=? AND published_version_id IS NOT NULL",id))

        // 같은 대상 회차의 새 게시판이 열려 있고 선택지·투표·제안 글·추천이 그대로 옮겨져 있어 같은 입력으로 다시 시도할 수 있다(선택지는 다시 만들지 않는다).
        assertEquals(0,count("SELECT count(*) FROM serial_choice WHERE board_id=?",failedId))
        val view=node(call("GET","$path/serial-board",reader))
        assertEquals(4,view.path("choices").size())
        assertEquals(listOf(0,0,1,0),votes(view))
        assertEquals(choice,view.path("myChoiceId").asString())
        assertEquals(listOf(proposal),ids(view))
        assertEquals(listOf(1),view.path("proposals").values().map {it.path("likes").asInt()})
        doAnswer { call -> episodeRequests.add(call.arguments[0] as Map<*,*>); generated }.`when`(ai).episode(ArgumentMatchers.anyMap<String,Any?>())
        assertEquals(202,call("POST","$path/ai-serial/run",owner).statusCode())
        runner.tick()
        await("the retry to be published") {"published" in statuses(id)}
        assertEquals(listOf("failed","published","open"),statuses(id))
        val request=episodeRequests.single()
        assertEquals(mapOf("text" to choiceTexts[2],"votes" to 1),request["choice"])
        assertEquals(listOf("재회"),(request["proposals"] as List<*>).map {(it as Map<*,*>)["title"]})
    }

    @Test fun `AI autonomous writing lets the owner write only episode 1 and leaving it waits for a run to end`() {
        val owner=member(); val stranger=member()
        val id=work(owner)
        val path="/api/v1/works/$id"
        val draft="""{"title":"2화","body":"쓰던 글","revision":0,"authorNote":""}"""
        assertEquals(200,autonomous(owner,path).statusCode())

        // 켜져 있는 동안 소유자는 1화만 직접 쓴다: 1화 초안·버전 저장은 된다.
        val first=call("GET","$path/episodes/1",owner)
        assertEquals(200,first.statusCode(),first.body())
        val saved=call("PUT","$path/episodes/1/draft",owner,"""{"title":"1화","body":"고친 1화","revision":${node(first).path("draft").path("revision").asInt()},"authorNote":""}""")
        assertEquals(200,saved.statusCode(),saved.body())
        val versioned=call("POST","$path/episodes/1/versions",owner,"""{"title":"1화","body":"고친 1화 저장","revision":${node(saved).path("draft").path("revision").asInt()},"authorNote":""}""")
        assertEquals(200,versioned.statusCode(),versioned.body())

        // 2화부터의 회차 쓰기와 작품 단위 쓰기(1화가 발행돼 대상은 2화)는 409 SERIAL_LOCKED다. 이미 1화가 있어 새 회차도 잠긴다.
        val locked=listOf(
            call("POST","$path/episodes",owner,"""{"title":"새 회차"}"""),
            call("PUT","$path/episodes/2/draft",owner,draft),
            call("POST","$path/episodes/2/versions",owner,draft),
            call("PUT","$path/draft",owner,draft),
            call("DELETE","$path/episodes/2/draft?revision=0",owner),
            call("POST","$path/episodes/2/publish",owner,"""{"revision":0,"rightsConfirmed":true,"versionId":"v"}"""),
            call("POST","$path/publish",owner,"""{"revision":0,"rightsConfirmed":true,"versionId":"v"}"""),
            call("POST","$path/episodes/2/publication-schedules",owner,"""{"versionId":"v","scheduledAt":"2099-01-01T00:00:00Z","rightsConfirmed":true}"""),
        )
        locked.forEachIndexed {i,response ->
            assertEquals(409,response.statusCode(),"$i ${response.body()}")
            assertEquals("SERIAL_LOCKED",code(response),"$i")
        }
        // 소유 확인이 먼저라 남은 404이고, 읽기는 막지 않는다.
        assertEquals(404,call("PUT","$path/episodes/2/draft",stranger,draft).statusCode())
        assertEquals(200,call("GET","$path/episodes",owner).statusCode())

        // 실행 중에는 다른 집필 방식으로 바꿀 수 없다(409 SERIAL_RUNNING). 앱 스케줄러(1분)가 실행을 끝내 결과가 흔들리지 않도록 running 상태를 직접 만든다(실행하는 주체가 없어 아무도 끝내지 않는다). 일정 수정은 된다.
        val assisted="""{"revision":1,"writingMode":"assisted"}"""
        jdbc.update("UPDATE serial_board SET status='running', closed_at=now() WHERE work_id=? AND status='open'",id)
        val refused=call("PUT","$path/operating-settings",owner,assisted)
        assertEquals(409,refused.statusCode(),refused.body())
        assertEquals("SERIAL_RUNNING",code(refused))
        assertEquals(200,call("PUT","$path/ai-serial",owner,schedule.replace("따뜻한 분위기로","다른 분위기로")).statusCode())
        jdbc.update("UPDATE serial_board SET status='open', closed_at=NULL WHERE work_id=? AND status='running'",id)

        // 실행 자신의 저장·발행은 잠금에 막히지 않는다(스케줄러가 먼저 가져가도 같은 결과). 끝나면 다른 방식으로 바꿀 수 있고, 꺼지면 소유자가 모든 회차를 쓸 수 있다.
        assertEquals(202,call("POST","$path/ai-serial/run",owner).statusCode())
        runner.tick()
        await("the run to publish") {"published" in statuses(id)}
        val back=call("PUT","$path/operating-settings",owner,assisted)
        assertEquals(200,back.statusCode(),back.body())
        assertFalse(node(call("GET","$path/ai-serial",owner)).path("enabled").asBoolean())
        assertEquals(201,call("POST","$path/episodes",owner,"""{"title":"새 회차"}""").statusCode())
    }

    @Test fun `AI autonomous writing opens no board before episode 1 is published and the owner writes episode 1 himself`() {
        val owner=member()
        val id=works.create(owner.toString(),CreateWorkRequest("연재 테스트","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        val path="/api/v1/works/$id"
        assertEquals(200,autonomous(owner,path).statusCode())

        // AI는 1화를 쓰지 않는다: 발행된 회차가 없으면 게시판이 없고 지금 실행은 409 SERIAL_NO_BOARD다.
        assertTrue(statuses(id).isEmpty())
        val run=call("POST","$path/ai-serial/run",owner)
        assertEquals(409,run.statusCode(),run.body())
        assertEquals("SERIAL_NO_BOARD",code(run))

        // 1화는 소유자가 직접 쓴다: 대상이 1화인 작품 단위 저장·발행은 자율 집필 중에도 된다. 발행되면 1분 점검이 2화 게시판을 연다.
        val draft=driver.edit(id,owner.toString(),DraftRequest("1화","본문",0))
        driver.publish(id,owner.toString(),PublishRequest(draft.revision,true,true,true,driver.history(id,owner.toString()).versions.last().id))
        runner.tick()
        await("the board for episode 2 to open") {statuses(id)==listOf("open")}
        assertEquals(2,node(call("GET","$path/serial-board")).path("board").path("episodeNumber").asInt())
    }

    @Test fun `the database keeps one active board per work four numbered choices one like per member and one vote per member and the claim is conditional`() {
        val owner=member()
        val id=work(owner)
        val first=UUID.randomUUID().toString()
        val second=UUID.randomUUID().toString()
        val insert="INSERT INTO serial_board(id,work_id,episode_number,status,opened_at) VALUES (?,?,?,?,now())"
        jdbc.update(insert,first,id,2,"open")
        // 작품당 열린(open·queued·running) 게시판은 하나이고 끝난 게시판은 세지 않는다.
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(insert,second,id,3,"queued")}
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(insert,second,id,3,"closed")}
        jdbc.update("UPDATE serial_board SET status='published' WHERE id=?",first)
        jdbc.update(insert,second,id,3,"open")

        // 선택지는 게시판마다 번호 1~4가 한 번씩이다.
        val choice=UUID.randomUUID().toString()
        val addChoice="INSERT INTO serial_choice(id,board_id,position,text) VALUES (?,?,?,'선택지')"
        jdbc.update(addChoice,choice,second,1)
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(addChoice,UUID.randomUUID().toString(),second,1)}
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(addChoice,UUID.randomUUID().toString(),second,0)}
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(addChoice,UUID.randomUUID().toString(),second,5)}

        // 제안 글은 같은 회원이 같은 게시판에 여러 개 쓸 수 있고 유형은 general·simulation뿐이다.
        val proposal=UUID.randomUUID().toString()
        val add="INSERT INTO serial_proposal(id,board_id,author_id,kind,title,body,created_at) VALUES (?,?,?,?,'제목','본문',now())"
        jdbc.update(add,proposal,second,"member","general")
        jdbc.update(add,UUID.randomUUID().toString(),second,"member","general")
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(add,UUID.randomUUID().toString(),second,"other","setting")}

        // 추천은 글마다 회원당 한 번, 표는 게시판마다 회원당 한 번이고 없는 선택지에는 던질 수 없다.
        jdbc.update("INSERT INTO serial_proposal_like(proposal_id,member_id) VALUES (?,?)",proposal,"member")
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update("INSERT INTO serial_proposal_like(proposal_id,member_id) VALUES (?,?)",proposal,"member")}
        jdbc.update("INSERT INTO serial_vote(board_id,member_id,choice_id) VALUES (?,?,?)",second,"member",choice)
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update("INSERT INTO serial_vote(board_id,member_id,choice_id) VALUES (?,?,?)",second,"member",choice)}
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update("INSERT INTO serial_vote(board_id,member_id,choice_id) VALUES (?,?,?)",second,"other","no-such-choice")}

        // 실행 선점은 켜진 연재에서만, 한 번만 성공한다(설정 행이 없거나 꺼졌으면 시작하지 않는다).
        assertFalse(serial.claim(second,"open",LocalDate.now(KST),Instant.now()))
        jdbc.update("INSERT INTO ai_serial(work_id,enabled,days,run_time,direction,updated_at) VALUES (?,true,?,'21:00','',now())",id,notToday)
        assertTrue(serial.claim(second,"open",LocalDate.now(KST),Instant.now()))
        assertFalse(serial.claim(second,"open",LocalDate.now(KST),Instant.now()))
        assertEquals("running",jdbc.queryForObject("SELECT status FROM serial_board WHERE id=?",String::class.java,second))
        assertNotNull(jdbc.queryForObject("SELECT closed_at FROM serial_board WHERE id=?",java.sql.Timestamp::class.java,second))
    }
}
