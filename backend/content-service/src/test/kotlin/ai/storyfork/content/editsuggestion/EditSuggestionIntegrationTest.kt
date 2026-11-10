package ai.storyfork.content.editsuggestion

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.`when`
import org.mockito.Mockito.doAnswer
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * 수정 제안 HTTP 계약(경로·Security·CSRF·상태 코드)과 V29 저장, 그리고 승인 반영의 실제 트랜잭션 경계를 실제 PostgreSQL로 검증한다.
 * 제안자 표시명의 정본은 Core 닉네임이라 Content에는 저장하지 않으며, Core는 [names]를 돌려주는 대역이다.
 * TEST_CONTENT_DATABASE_URL이 있을 때만 실행하며, DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 행만 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class EditSuggestionIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    /** Core 닉네임 대역이다. 회원 id → 최신 닉네임이며, 없는 회원은 Core에 없는(탈퇴한) 회원이다. */
    private val names: MutableMap<String,String> = ConcurrentHashMap()
    private val body="그는 문을 열었다. 않 된다고 말했다. 그리고 떠났다."
    private val overflow="제목은 120자, 원고는 40,000자 이내로 작성해 주세요."

    /** 닉네임 대역을 (다시) 설치한다. 예외를 던지게 스텁한 뒤에도 부를 수 있도록 `when(mock.m())` 대신 `doAnswer`를 쓴다(`when`은 호출 자체가 스텁된 예외를 던진다). */
    @BeforeEach fun coreNicknames() {
        doAnswer {call ->
            (call.arguments[0] as Collection<*>).map {it as String}.filter {it in names}.associateWith {names.getValue(it)}
        }.`when`(nicknames).nicknames(ArgumentMatchers.anyCollection<String>())
    }

    /** Core가 확인해 주는 회원이다. 닉네임을 주면 Core 닉네임 대역에도 등록한다. */
    private fun member(nickname: String? = "닉네임"): UUID=UUID.randomUUID().also { id ->
        `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
        if(nickname!=null) names[id.toString()]=nickname
    }
    private fun call(method: String,path: String,member: UUID? = null,body: String? = null,csrf: Boolean = true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
            .method(method,if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        if(body!=null) request.header("Content-Type","application/json")
        if(method!="GET" && csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun write(id: String,number: Int = 1)="/api/v1/works/$id/episodes/$number/edit-suggestions"
    private fun one(id: String,suggestion: String)="/api/v1/works/$id/edit-suggestions/$suggestion"
    private fun payload(before: String = "않 된다고",after: String = "안 된다고",reason: String? = null)=
        json.writeValueAsString(mapOf("beforeText" to before,"afterText" to after,"reason" to reason))
    private fun post(id: String,member: UUID?,data: String = payload(),number: Int = 1)=call("POST",write(id,number),member,data)
    private fun detail(id: String,suggestion: String,member: UUID?)=call("GET",one(id,suggestion),member)
    private fun act(id: String,suggestion: String,member: UUID?,action: String,data: String? = null)=call("POST","${one(id,suggestion)}/$action",member,data)
    private fun node(response: HttpResponse<String>): JsonNode=json.readTree(response.body())
    private fun ids(response: HttpResponse<String>)=node(response).path("items").toList().map {it.path("id").asString()}
    private fun created(response: HttpResponse<String>): String {
        assertEquals(201,response.statusCode(),response.body())
        return node(response).path("id").asString()
    }
    private fun ok(response: HttpResponse<String>): JsonNode {
        assertEquals(200,response.statusCode(),response.body())
        return node(response)
    }
    private fun count(sql: String,vararg args: Any)=jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun publishedVersion(work: String)=jdbc.queryForObject("SELECT published_version_id FROM episode_current WHERE work_id=? AND sequence=1",String::class.java,work)!!
    private fun draftContent(work: String)=jdbc.queryForObject("SELECT d.content FROM episode_draft d JOIN episode e ON e.id=d.episode_id WHERE e.work_id=? AND e.sequence=1",String::class.java,work)!!
    private fun versionCount(work: String)=count("SELECT count(*) FROM episode_version v JOIN episode e ON e.id=v.episode_id WHERE e.work_id=?",work)
    private fun row(suggestion: String)=jdbc.queryForObject("SELECT status,apply_result,apply_failure,applied_version_id FROM edit_suggestion WHERE id=?",
        {rs,_ -> listOf<Any?>(rs.getString(1),rs.getString(2),rs.getString(3),rs.getString(4))},suggestion)!!

    private fun work(owner: String,publish: Boolean = true): String {
        val id=works.create(owner,CreateWorkRequest("수정 제안 테스트","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        if(publish) {
            val draft=driver.edit(id,owner,DraftRequest("1화",body,0))
            driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        }
        return id
    }
    private fun rewrite(id: String,owner: String,text: String) {
        val episode=driver.writing(id,owner,1)
        driver.writeEpisode(id,owner,1,DraftRequest("1화",text,episode.draft.revision),false)
    }

    @Test fun `suggestion lifecycle pins the published version stores no name and approval makes a new draft version without publishing`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reader=member("독자")
        val stranger=member("다른 독자")

        val response=post(id,reader,payload(reason="  맞춤법  "))
        val sid=created(response)
        val version=publishedVersion(id)
        val shown=node(response)
        assertEquals(listOf<Any?>(id,1,version,"독자","reader","않 된다고","안 된다고",null,"맞춤법","pending","auto",true,false),
            listOf(shown.path("workId").asString(),shown.path("episodeNumber").asInt(),shown.path("publishedVersionId").asString(),shown.path("proposerName").asString(),
                shown.path("source").asString(),shown.path("beforeText").asString(),shown.path("afterText").asString(),shown.path("editedText").takeIf {!it.isNull},
                shown.path("reason").asString(),shown.path("status").asString(),shown.path("scope").asString(),shown.path("mine").asBoolean(),shown.path("owner").asBoolean()))
        assertEquals(version,jdbc.queryForObject("SELECT published_version_id FROM edit_suggestion WHERE id=?",String::class.java,sid))
        // 이 슬라이스에서 제보 연결 칸은 항상 비어 있고, 제안자 이름은 저장하지 않는다.
        assertEquals(0,count("SELECT count(*) FROM edit_suggestion WHERE id=? AND report_id IS NOT NULL",sid))
        assertEquals(0,count("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='edit_suggestion' AND column_name='proposer_name'"))

        // 제안자와 작품 소유자만 열람한다.
        assertEquals(listOf(true,false),node(detail(id,sid,reader)).let {listOf(it.path("mine").asBoolean(),it.path("owner").asBoolean())})
        assertEquals(listOf(false,true),node(detail(id,sid,owner)).let {listOf(it.path("mine").asBoolean(),it.path("owner").asBoolean())})
        assertEquals(404,detail(id,sid,stranger).statusCode())
        assertEquals(401,call("GET",one(id,sid)).statusCode())
        assertEquals(listOf(sid),ids(call("GET","/api/v1/works/edit-suggestions/mine",reader)))
        assertEquals(emptyList<String>(),ids(call("GET","/api/v1/works/edit-suggestions/mine",stranger)))
        assertTrue(sid in ids(call("GET","/api/v1/works/edit-suggestions/inbox",owner)))
        assertEquals(emptyList<String>(),ids(call("GET","/api/v1/works/edit-suggestions/inbox",reader)))

        // 편집안은 원래 제안을 보존한다.
        val edited=ok(call("PUT","${one(id,sid)}/edited-text",owner,"""{"editedText":"안 된다고요"}"""))
        assertEquals(listOf("안 된다고요","안 된다고"),listOf(edited.path("editedText").asString(),edited.path("afterText").asString()))

        // 승인은 새 초안 버전으로만 반영하고 발행본은 그대로다.
        val versions=versionCount(id)
        val approved=ok(act(id,sid,owner,"approval"))
        assertEquals(listOf("approved","applied",true),listOf(approved.path("status").asString(),approved.path("applyResult").asString(),approved.path("applyFailure").isNull))
        val applied=approved.path("appliedVersionId").asString()
        assertEquals(versions+1,versionCount(id))
        assertEquals("그는 문을 열었다. 안 된다고요 말했다. 그리고 떠났다.",jdbc.queryForObject("SELECT content FROM episode_version WHERE id=?",String::class.java,applied))
        assertEquals("그는 문을 열었다. 안 된다고요 말했다. 그리고 떠났다.",draftContent(id))
        assertEquals(version,publishedVersion(id))
        assertEquals(body,jdbc.queryForObject("SELECT content FROM episode_version WHERE id=?",String::class.java,version))
        assertEquals(listOf<Any?>("approved","applied",null,applied),row(sid))
        assertEquals(409,act(id,sid,owner,"approval").statusCode())
        assertEquals(versions+1,versionCount(id))
    }

    @Test fun `a sentence the owner already changed in the draft is recorded as a failed apply and a retry can still succeed`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val sid=created(post(id,member()))
        rewrite(id,owner.toString(),"작가가 이미 고쳐 쓴 전혀 다른 본문.")
        val versions=versionCount(id)

        val failed=ok(act(id,sid,owner,"approval"))

        assertEquals(listOf("approved","failed"),listOf(failed.path("status").asString(),failed.path("applyResult").asString()))
        assertTrue(failed.path("applyFailure").asString().contains("집필실"))
        assertTrue(failed.path("appliedVersionId").isNull)
        assertEquals(listOf<Any?>("approved","failed",failed.path("applyFailure").asString(),null),row(sid))
        assertEquals(versions,versionCount(id))
        // 반영 실패한 승인은 거절할 수 없지만 초안을 고친 뒤 다시 승인할 수 있다.
        assertEquals(409,act(id,sid,owner,"rejection").statusCode())
        rewrite(id,owner.toString(),body)
        val retried=ok(act(id,sid,owner,"approval"))
        assertEquals(listOf("approved","applied",true),listOf(retried.path("status").asString(),retried.path("applyResult").asString(),retried.path("applyFailure").isNull))
        assertEquals(versions+1,versionCount(id))
        assertEquals("그는 문을 열었다. 안 된다고 말했다. 그리고 떠났다.",draftContent(id))
    }

    @Test fun `a save that fails after the transaction was marked for rollback is recorded as failed in its own transaction`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val sid=created(post(id,member()))
        // 초안이 40,000자 한도에 가까운 상태에서 긴 편집안을 승인하면 기존 저장 규칙이 422로 거절한다.
        val huge="가".repeat(39_950)+" 않 된다고"
        rewrite(id,owner.toString(),huge)
        ok(call("PUT","${one(id,sid)}/edited-text",owner,json.writeValueAsString(mapOf("editedText" to "안 된다고"+" 길게".repeat(20)))))
        val versions=versionCount(id)

        val result=ok(act(id,sid,owner,"approval"))

        assertEquals(listOf("approved","failed",overflow),listOf(result.path("status").asString(),result.path("applyResult").asString(),result.path("applyFailure").asString()))
        // 실패한 저장은 흔적 없이 되돌려지고, 실패 기록만 별도 트랜잭션으로 남는다.
        assertEquals(huge,draftContent(id))
        assertEquals(versions,versionCount(id))
        assertEquals(listOf<Any?>("approved","failed",overflow,null),row(sid))
    }

    @Test fun `an answer that cannot be built because Core is down rolls the whole approval back`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reader=member()
        val sid=created(post(id,reader))
        val versions=versionCount(id)
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>()))
            .thenThrow(CoreAuthException(503,"CORE_MEMBER_UNAVAILABLE","회원 정보 서비스를 사용할 수 없습니다."))

        val approval=act(id,sid,owner,"approval")

        assertEquals(503,approval.statusCode(),approval.body())
        assertEquals("회원 정보 서비스를 사용할 수 없습니다.",node(approval).path("detail").asString())
        assertEquals(listOf<Any?>("pending",null,null,null),row(sid))
        assertEquals(body,draftContent(id))
        assertEquals(versions,versionCount(id))
        assertEquals(503,detail(id,sid,owner).statusCode())
        assertEquals(503,post(id,reader).statusCode())
        assertEquals(1,count("SELECT count(*) FROM edit_suggestion WHERE work_id=?",id))
        // Core가 돌아오면 같은 승인이 그대로 성공한다.
        coreNicknames()
        assertEquals("applied",ok(act(id,sid,owner,"approval")).path("applyResult").asString())
    }

    @Test fun `a changed base published version is a 409 and the suggestion stays pending`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val sid=created(post(id,member()))
        val episode=driver.writing(id,owner.toString(),1)
        val saved=driver.writeEpisode(id,owner.toString(),1,DraftRequest("1화 개정","개정 본문. 않 된다고 말했다.",episode.draft.revision),true)
        driver.publishEpisode(id,owner.toString(),1,PublishRequest(saved.draft.revision,true,true,true,saved.versions.last().id))
        val versions=versionCount(id)

        val approval=act(id,sid,owner,"approval")

        assertEquals(409,approval.statusCode(),approval.body())
        assertEquals("기준 발행본이 바뀌어 다시 검토해야 해요.",node(approval).path("detail").asString())
        assertEquals(listOf<Any?>("pending",null,null,null),row(sid))
        assertEquals(versions,versionCount(id))
        // 새 발행본에 대한 새 제안은 그 발행본을 기준으로 고정된다.
        val next=created(post(id,member()))
        assertEquals(publishedVersion(id),node(detail(id,next,owner)).path("publishedVersionId").asString())
    }

    @Test fun `owner only actions answer 401 and csrf 403 and 403 for the proposer and 404 for a stranger and a decided suggestion answers 409`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reader=member()
        val stranger=member()
        val sid=created(post(id,reader))

        assertEquals(401,act(id,sid,null,"hold").statusCode())
        assertEquals(403,call("POST","${one(id,sid)}/hold",owner,csrf=false).statusCode())
        assertEquals(403,act(id,sid,reader,"hold").statusCode())
        assertEquals(404,act(id,sid,stranger,"hold").statusCode())
        assertEquals(listOf<Any?>("pending",null,null,null),row(sid))

        assertEquals("held",ok(act(id,sid,owner,"hold")).path("status").asString())
        assertEquals(409,act(id,sid,owner,"hold").statusCode())
        // 거절 사유는 선택이라 본문 없이도 거절된다(상태 전이 전체는 서비스 단위 테스트가 검증한다).
        assertEquals("rejected",ok(act(id,sid,owner,"rejection")).path("status").asString())
        assertEquals(409,act(id,sid,owner,"approval").statusCode())
    }

    @Test fun `invalid input and sentences outside the published text are rejected before anything is stored`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reader=member()
        val tooLong="가".repeat(501)

        for(bad in listOf("""{}""","""{"beforeText":"","afterText":"안 된다고"}""","""{"beforeText":"않 된다고","afterText":"  "}""",payload(before=tooLong),payload(after=tooLong),
            payload(reason=tooLong),payload(before="않\u0000 된다고"),payload(after="않 된다고"),payload(after="  않 된다고  "))) {
            assertEquals(422,post(id,reader,bad).statusCode(),bad.take(40))
        }
        assertEquals(400,post(id,reader,"{broken").statusCode())
        val missing=post(id,reader,payload(before="본문에 없는 문장",after="고친 문장"))
        assertEquals(422,missing.statusCode())
        assertEquals("원문에서 고칠 문장을 찾을 수 없어요.",node(missing).path("detail").asString())
        assertEquals(0,count("SELECT count(*) FROM edit_suggestion WHERE work_id=?",id))
        // 입력 검증은 접근 판정보다 먼저라 없는 작품이어도 422다.
        assertEquals(422,post(UUID.randomUUID().toString(),reader,"""{}""").statusCode())
    }

    @Test fun `only published episodes of public works take suggestions and writing needs a verified member and csrf`() {
        val owner=member("작가")
        val open=work(owner.toString())
        val hidden=work(owner.toString(),publish=false)
        val reader=member()

        assertEquals(401,post(open,null).statusCode())
        assertEquals(403,call("POST",write(open),reader,payload(),csrf=false).statusCode())
        for((target,number) in listOf(hidden to 1,open to 2,open to 0,UUID.randomUUID().toString() to 1)) {
            assertEquals(404,post(target,reader,number=number).statusCode(),"write $target $number")
        }
        assertEquals(0,count("SELECT count(*) FROM edit_suggestion WHERE work_id IN (?,?)",open,hidden))
        // 작품 소유자도 자기 작품에 제안할 수 있다.
        assertTrue(node(post(open,owner)).let {it.path("mine").asBoolean() && it.path("owner").asBoolean()})
    }

    @Test fun `the proposer name follows the latest Core nickname and the inbox only shows my own works`() {
        val owner=member("작가")
        val mine=work(owner.toString())
        val otherOwner=member("다른 작가")
        val theirs=work(otherOwner.toString())
        val reader=member("처음 닉네임")
        val first=created(post(mine,reader))
        val elsewhere=created(post(theirs,reader))
        val second=created(post(mine,reader,payload(after="안 된다 고")))

        assertEquals(listOf(second,first),ids(call("GET","/api/v1/works/edit-suggestions/inbox",owner)).filter {it in setOf(first,second,elsewhere)})
        assertEquals(listOf(elsewhere),ids(call("GET","/api/v1/works/edit-suggestions/inbox",otherOwner)))
        assertEquals(listOf(second,elsewhere,first),ids(call("GET","/api/v1/works/edit-suggestions/mine",reader)))

        names[reader.toString()]="바꾼 닉네임"
        assertEquals("바꾼 닉네임",node(detail(mine,first,owner)).path("proposerName").asString())
        names.remove(reader.toString())
        assertEquals("탈퇴한 회원",node(detail(mine,first,owner)).path("proposerName").asString())
        assertEquals("탈퇴한 회원",node(detail(mine,first,reader)).path("proposerName").asString())
    }
}
