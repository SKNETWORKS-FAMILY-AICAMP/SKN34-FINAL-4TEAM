package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.world.service.dto.*
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.*
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * Hosted CI only: 운영 정보 누설 비교 기준(DEC-55) 내부 API를 실제 Content HTTP·서비스 토큰 체인·PostgreSQL(작품 + WorldStudio)·Neo4j로 확인한다.
 * 안 보이는 카드 판정(DEC-53)과 Fork 기준 회차 고정, 원작의 기준 회차 뒤 회차 제목, 제목만 나가고 본문은 안 나감, Fork 독자가 이미 읽은 본문(물려받은 원작 발행본·Fork가 발행한 회차)에 나온 제목이 빠짐을 본다.
 * Core 회원 검증과 닉네임은 대역이다.
 */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class InternalLeakReferencesIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Core {
        @Bean @Primary fun leakReferencesTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
        @Bean @Primary fun leakReferencesTestCoreNicknames():CoreNicknameService=mock(CoreNicknameService::class.java)
    }

    private val token="leak-references-test-token-at-least-32"
    private val wrongToken="wrong-service-token-wrong-service-token"

    @Test fun `the operations token reads the origin cards a Fork reader cannot see and the origin episode titles after the basis episode, titles only and minus titles the Fork reader already read`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Core::class.java,ContentTestConfig::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
                "--OPERATIONS_SERVICE_TOKEN=$token").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val owner=UUID.randomUUID();val forker=UUID.randomUUID()
                for(id in listOf(owner,forker)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                val works=ctx.getBean(WorkService::class.java);val driver=ctx.getBean(ContentTestDriver::class.java)
                val host="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}"
                fun send(path:String,actor:UUID?=owner,method:String="GET",body:Any?=null,serviceToken:String?=null):HttpResponse<String> {
                    val request=HttpRequest.newBuilder(URI.create(host+path)).header("Content-Type","application/json")
                    if(actor!=null)request.header("Authorization","Bearer $actor")
                    if(serviceToken!=null)request.header("X-Operations-Service-Token",serviceToken)
                    if(method!="GET"&&path.startsWith("/api/"))request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null)HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
                }
                fun json(response:HttpResponse<String>):JsonNode=mapper.readTree(response.body())
                fun internal(path:String,serviceToken:String?=token)=send(path,actor=null,serviceToken=serviceToken)
                fun titles(node:JsonNode)=node.values().map { it.asString() }
                fun work(actor:UUID,title:String):String=works.create(actor.toString(),CreateWorkRequest(title,"소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
                /** 이미 만들어진 [number]화 초안을 [actor]가 [title]·[body]로 저장 버전으로 확정해 발행한다. */
                fun publish(id:String,number:Int,title:String,body:String="본문",actor:UUID=owner) {
                    val saved=driver.writeEpisode(id,actor.toString(),number,DraftRequest(title,body,driver.writing(id,actor.toString(),number).draft.revision),true)
                    driver.publishEpisode(id,actor.toString(),number,PublishRequest(saved.draft.revision,true,true,true,saved.versions.last().id))
                }

                // 원작 세계관: 1화부터 공개 카드, 3화에 공개되는 카드, 공개 회차가 없는 작가 전용 카드, 4화에 공개되지만 원작 2화 본문에 먼저 나오는 카드. 확정해 원작에 연결한다.
                val create=CreateWorldRequest("누설 기준 세계관","설명");val world=create.id
                assertEquals(200,send("/api/v1/world-studios",method="POST",body=create).statusCode())
                fun card(title:String,visibility:String,reveal:Int?)=CardPayload(UUID.randomUUID(),title,"$title 카드 원문","character","basic",
                    semanticMetadata=if(reveal==null) emptyMap() else mapOf("revealFromEpisode" to reveal),visibility=visibility)
                assertEquals(200,send("/api/v1/world-studios/$world/draft",method="PUT",body=EditWorldDraftRequest(0,create.name,"설명",
                    listOf(card("1화 공개 인물","public",1),card("3화 공개 인물","private",3),card("작가 전용 인물","private",null),card("초반 언급 인물","private",4)),emptyList(),"leak-edit",true)).statusCode())
                assertEquals(200,send("/api/v1/world-studios/$world/revisions",method="POST",body=SaveWorldRequest(1,"leak-save")).statusCode())
                val origin=work(owner,"누설 기준 원작")
                assertEquals(200,send("/api/v1/works/$origin/world-studio",method="PUT",body=mapOf("worldId" to world)).statusCode())

                // 원작은 1·2화를 발행하고 3화는 제목만 있는 초안이다. 2화에서 갈라진 Fork를 만든다.
                val first=driver.edit(origin,owner.toString(),DraftRequest("1화","본문",0))
                driver.publish(origin,owner.toString(),PublishRequest(first.revision,true,true,true,driver.history(origin,owner.toString()).versions.last().id))
                publish(origin,2,"2화","2화에서 초반 언급 인물이 먼저 나온다")
                driver.createEpisode(origin,owner.toString(),ai.storyfork.content.fixture.CreateWorkRequest("비밀 3화 제목"))
                val fork=driver.fork(origin,forker.toString(),ai.storyfork.content.fixture.ForkRequest(2,"분기")).id
                val path="/internal/v1/works/$fork/leak-references"

                // 서비스 토큰만 통과한다. 회원 Bearer나 틀린 토큰은 403이다.
                for(wrong in listOf(null,wrongToken)) assertEquals(403,internal(path,wrong).statusCode())
                assertEquals(403,send(path,actor=forker).statusCode())

                val response=internal(path);assertEquals(200,response.statusCode(),response.body())
                val body=json(response)
                assertEquals(origin,body.path("originWorkId").asString())
                // 4화 카드 '초반 언급 인물'도 기준 회차 2화에는 안 보이지만 Fork가 물려받은 원작 2화 본문에 이미 나와 빠진다.
                assertEquals(listOf("3화 공개 인물","작가 전용 인물"),titles(body.path("privateCardTitles")))
                assertEquals(listOf("비밀 3화 제목"),titles(body.path("unpublishedEpisodeTitles")))
                assertEquals(setOf("originWorkId","privateCardTitles","unpublishedEpisodeTitles"),body.propertyNames().toSet())
                // 제목만 나간다: 카드 본문·원고 본문은 없고 Fork 기준 회차에 이미 보이는 카드와 회차 제목도 없다.
                for(leak in listOf("카드 원문","본문","1화 공개 인물")) assertFalse(response.body().contains(leak),leak)

                // 원작이 Fork 뒤에 3화를 발행해도 기준은 Fork가 갈라진 2화로 고정이다: 3화 카드는 계속 안 보이는 카드이고 그 회차 제목은 기준 밖이다.
                publish(origin,3,"3화 발행 제목")
                val later=json(internal(path))
                assertEquals(listOf("3화 공개 인물","작가 전용 인물"),titles(later.path("privateCardTitles")))
                assertEquals(listOf("3화 발행 제목"),titles(later.path("unpublishedEpisodeTitles")))

                // Fork가 직접 발행한 3화 본문에 나온 카드 제목은 독자가 이미 읽은 글이라 빠지고 안 나온 카드는 남는다. 원작 3화 제목은 그 본문에 없어 남는다.
                publish(fork,3,"분기 3화","분기 3화에서 작가 전용 인물이 나타난다",forker)
                val own=json(internal(path))
                assertEquals(listOf("3화 공개 인물"),titles(own.path("privateCardTitles")))
                assertEquals(listOf("3화 발행 제목"),titles(own.path("unpublishedEpisodeTitles")))

                // 원작에서 세계관을 풀면 카드 제목은 비고 회차 제목은 그대로다.
                assertEquals(200,send("/api/v1/works/$origin/world-studio",method="PUT",body=mapOf("worldId" to null)).statusCode())
                val unlinked=json(internal(path))
                assertEquals(0,unlinked.path("privateCardTitles").size());assertEquals(listOf("3화 발행 제목"),titles(unlinked.path("unpublishedEpisodeTitles")))

                // 원작 3화 제목이 Fork가 발행한 4화 본문에 그대로 나오면 회차 제목도 같은 규칙으로 빠진다.
                driver.createEpisode(fork,forker.toString(),ai.storyfork.content.fixture.CreateWorkRequest("분기 4화 초안"))
                publish(fork,4,"분기 4화","분기 4화에서 3화 발행 제목이 읽힌다",forker)
                assertEquals(0,json(internal(path)).path("unpublishedEpisodeTitles").size())

                // Fork가 아닌 작품은 원작 없이 빈 목록이고, 없는 작품과 삭제된 작품은 404다.
                val plain=json(internal("/internal/v1/works/$origin/leak-references"))
                assertTrue(plain.path("originWorkId").isNull);assertEquals(0,plain.path("privateCardTitles").size());assertEquals(0,plain.path("unpublishedEpisodeTitles").size())
                val gone=work(owner,"삭제될 작품")
                assertEquals(204,send("/api/v1/works/$gone",method="DELETE").statusCode())
                for(id in listOf(UUID.randomUUID().toString(),gone)) assertEquals(404,internal("/internal/v1/works/$id/leak-references").statusCode(),id)
            }
        }
    }
}
