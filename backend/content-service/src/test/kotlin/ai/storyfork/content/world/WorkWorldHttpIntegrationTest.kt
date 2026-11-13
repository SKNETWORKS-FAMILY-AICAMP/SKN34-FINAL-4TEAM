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
 * Hosted CI only: 세계관-소설 1:1 연결과 독자 설정 위키(DEC-46)를 실제 Content HTTP/CSRF/보안·PostgreSQL(작품 + WorldStudio, V37 UNIQUE)·Neo4j로 확인한다.
 * Core 회원 검증과 닉네임은 대역이다(작가명은 이 테스트가 보지 않는다).
 */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorkWorldHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Core {
        @Bean @Primary fun workWorldTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
        @Bean @Primary fun workWorldTestCoreNicknames():CoreNicknameService=mock(CoreNicknameService::class.java)
    }

    @Test fun `a world links to one work only, owner responses show the link, deleting a work releases it, and readers see only the cards revealed up to the published episode`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Core::class.java,ContentTestConfig::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val owner=UUID.randomUUID();val other=UUID.randomUUID()
                for(id in listOf(owner,other)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                val works=ctx.getBean(WorkService::class.java);val driver=ctx.getBean(ContentTestDriver::class.java)
                val host="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}"
                val studios="/api/v1/world-studios"
                fun send(path:String,actor:UUID?=owner,method:String="GET",body:Any?=null,csrf:Boolean=true):HttpResponse<String> {
                    val request=HttpRequest.newBuilder(URI.create(host+path)).header("Content-Type","application/json")
                    if(actor!=null)request.header("Authorization","Bearer $actor")
                    if(csrf&&method!="GET")request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null)HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
                }
                fun json(response:HttpResponse<String>):JsonNode=mapper.readTree(response.body())
                /** 비로그인 읽기: Authorization 없이 보낸다. */
                fun anonymous(path:String)=send(path,actor=null)
                fun link(work:String,world:Any?,actor:UUID?=owner,csrf:Boolean=true)=send("/api/v1/works/$work/world-studio",actor,"PUT",mapOf("worldId" to world),csrf)
                fun work(actor:UUID,title:String):String=works.create(actor.toString(),CreateWorkRequest(title,"소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
                /** 1화를 발행해 작품을 공개한다. 발행하면 다음 회차 초안이 생긴다. */
                fun publishFirst(id:String) {
                    val draft=driver.edit(id,owner.toString(),DraftRequest("1화","본문",0))
                    driver.publish(id,owner.toString(),PublishRequest(draft.revision,true,true,true,driver.history(id,owner.toString()).versions.last().id))
                }
                /** 이미 만들어진 [number]화 초안을 저장 버전으로 확정해 발행한다. */
                fun publishNext(id:String,number:Int) {
                    val saved=driver.writeEpisode(id,owner.toString(),number,DraftRequest("${number}화","본문",driver.writing(id,owner.toString(),number).draft.revision),true)
                    driver.publishEpisode(id,owner.toString(),number,PublishRequest(saved.draft.revision,true,versionId=saved.versions.last().id))
                }

                // 세계관: 독자 공개 회차가 1·2·3화인 카드, 회차가 없는 공개 카드, 값이 정수가 아닌 카드. 확정 버전은 아직 없다.
                val create=CreateWorldRequest("연결할 세계관","설명");val world=create.id
                assertEquals(200,send(studios,method="POST",body=create).statusCode())
                fun card(title:String,visibility:String,reveal:Any?)=CardPayload(UUID.randomUUID(),title,"$title 원문","character","basic",
                    semanticMetadata=if(reveal==null) emptyMap() else mapOf("revealFromEpisode" to reveal),visibility=visibility)
                val first=card("1화 인물","private",1)
                val second=card("2화 인물","public",2)
                val third=card("3화 인물","public",3)
                val never=card("독자 비공개 인물","public",null)
                val text=card("회차가 글자인 인물","public","1")
                val together=RelationshipPayload(UUID.randomUUID(),first.id,second.id,"structural","관계 설명 원문",label="동료")
                val later=RelationshipPayload(UUID.randomUUID(),first.id,third.id,"structural","나중 관계 설명",label="나중에 만나는 사이")
                val unseen=RelationshipPayload(UUID.randomUUID(),first.id,never.id,"structural","숨은 관계 설명",label="숨은 사이")
                assertEquals(200,send("$studios/$world/draft",method="PUT",
                    body=EditWorldDraftRequest(0,create.name,"설명",listOf(first,second,third,never,text),listOf(together,later,unseen),"link-edit",true)).statusCode())
                val mine=work(owner,"연결할 소설");val another=work(owner,"둘째 소설");val theirs=work(other,"남의 소설")
                val foreign=CreateWorldRequest("남의 세계관","")
                assertEquals(200,send(studios,actor=other,method="POST",body=foreign).statusCode())
                val wiki="/api/v1/public/works/$mine/world-cards"

                // 인증·CSRF는 기존 /api/v1/works/** 규칙 그대로이고, 작품과 세계관 모두 요청자 것이어야 한다(아니면 404).
                assertEquals(401,link(mine,world,actor=null).statusCode())
                assertEquals(403,link(mine,world,csrf=false).statusCode())
                assertEquals(404,link(theirs,world).statusCode())
                assertEquals(404,link(mine,world,actor=other).statusCode())
                assertEquals(404,link(mine,foreign.id).statusCode())
                assertEquals(404,link(mine,UUID.randomUUID()).statusCode())
                assertEquals(400,link(mine,"not-a-uuid").statusCode())
                assertTrue(json(send("/api/v1/works/$mine")).path("worldStudioId").isNull)
                assertTrue(json(send("$studios/$world")).path("linkedWorkId").isNull)

                // 연결: 다시 보내도 같고, 소유자의 작품·세계관 응답(상세·목록)이 서로를 가리킨다.
                val linked=link(mine,world);assertEquals(200,linked.statusCode())
                assertEquals(mine,json(linked).path("workId").asString());assertEquals(world.toString(),json(linked).path("worldId").asString())
                assertEquals(200,link(mine,world).statusCode())
                assertEquals(world.toString(),json(send("/api/v1/works/$mine")).path("worldStudioId").asString())
                assertEquals(world.toString(),json(send("/api/v1/works")).values().first { it.path("id").asString()==mine }.path("worldStudioId").asString())
                assertEquals(mine,json(send("$studios/$world")).path("linkedWorkId").asString())
                assertEquals(mine,json(send(studios)).values().first { it.path("worldId").asString()==world.toString() }.path("linkedWorkId").asString())

                // 한 세계관은 한 작품에만: 다른 작품에 연결하면 409 WORLD_ALREADY_LINKED이고 기존 연결은 그대로다.
                val conflict=link(another,world);assertEquals(409,conflict.statusCode());assertEquals("WORLD_ALREADY_LINKED",json(conflict).path("code").asString())
                assertEquals(mine,json(send("$studios/$world")).path("linkedWorkId").asString())
                assertTrue(json(send("/api/v1/works/$another")).path("worldStudioId").isNull)

                // 독자 설정 위키: 공개 전 작품은 연결 여부도 알리지 않는 빈 목록이고, 공개 응답에는 연결이 나오지 않는다.
                val beforePublic=anonymous(wiki);assertEquals(200,beforePublic.statusCode())
                assertTrue(json(beforePublic).path("worldId").isNull);assertEquals(0,json(beforePublic).path("cards").size())
                publishFirst(mine)
                assertTrue(json(anonymous("/api/v1/public/works/$mine")).path("worldStudioId").isNull)
                // 작품은 공개됐지만 세계관에 확정 버전이 없다: 초안은 독자에게 보이지 않는다.
                val draftOnly=json(anonymous(wiki))
                assertEquals(world.toString(),draftOnly.path("worldId").asString());assertEquals(0,draftOnly.path("cards").size());assertEquals(1,draftOnly.path("upto").asInt())

                // 확정 버전이 생기면 발행된 1화까지의 카드만 보인다. 비공개 카드라도 독자 공개 회차가 있으면 보이고, upto는 발행된 회차를 넘지 못한다.
                assertEquals(200,send("$studios/$world/revisions",method="POST",body=SaveWorldRequest(1,"link-save")).statusCode())
                val one=json(anonymous(wiki))
                assertEquals(mine,one.path("workId").asString());assertEquals(1,one.path("upto").asInt());assertEquals("current",one.path("relationshipStatus").asString())
                assertEquals(listOf(first.id.toString()),one.path("cards").values().map { it.path("id").asString() })
                val shown=one.path("cards").get(0)
                assertEquals("1화 인물",shown.path("title").asString());assertEquals("1화 인물 원문",shown.path("text").asString())
                assertEquals("character",shown.path("cardType").asString());assertEquals(1,shown.path("revealFromEpisode").asInt())
                assertEquals(0,one.path("relationships").size())
                val beyond=json(anonymous("$wiki?upto=5"))
                assertEquals(1,beyond.path("upto").asInt());assertEquals(1,beyond.path("cards").size())

                // 2화를 발행하면 2화 카드와 두 카드 사이의 관계가 보인다. 3화 카드·회차 없는 카드·값이 글자인 카드와 그쪽 관계, 관계 설명 원문은 나오지 않는다.
                publishNext(mine,2)
                val two=anonymous(wiki);val twoView=json(two)
                assertEquals(2,twoView.path("upto").asInt())
                assertEquals(setOf(first.id.toString(),second.id.toString()),twoView.path("cards").values().map { it.path("id").asString() }.toSet())
                assertEquals(1,twoView.path("relationships").size())
                val edge=twoView.path("relationships").get(0)
                assertEquals(together.id.toString(),edge.path("id").asString());assertEquals(first.id.toString(),edge.path("sourceCardId").asString())
                assertEquals(second.id.toString(),edge.path("targetCardId").asString());assertEquals("동료",edge.path("label").asString())
                for(leak in listOf(third.id.toString(),never.id.toString(),text.id.toString(),"관계 설명 원문","나중에 만나는 사이","숨은 사이")) assertFalse(two.body().contains(leak),leak)
                // 회차 화면에서 온 요청(1화 기준)에는 2화 카드가 없다.
                assertEquals(listOf(first.id.toString()),json(anonymous("$wiki?upto=1")).path("cards").values().map { it.path("id").asString() })
                for(bad in listOf("0","-1","x")) assertEquals(422,anonymous("$wiki?upto=$bad").statusCode())
                assertEquals(404,anonymous("/api/v1/public/works/${UUID.randomUUID()}/world-cards").statusCode())
                assertTrue(listOf(401,403).contains(send(wiki,actor=null,method="POST",body=emptyMap<String,String>()).statusCode()))
                // 세계관 공개(다른 이용자 대상)와 독자 공개는 별개다: 이 세계관은 비공개라 공개 세계관 조회에는 없다.
                assertEquals(404,anonymous("/api/v1/public/world-studios/$world").statusCode())

                // 확정하지 않은 초안의 변경(3화 카드를 1화로 당김)은 독자에게 반영되지 않고, 저장 응답에도 연결이 그대로 있다.
                val edited=send("$studios/$world/draft",method="PUT",body=EditWorldDraftRequest(2,create.name,"설명",listOf(third.copy(semanticMetadata=mapOf("revealFromEpisode" to 1))),key="draft-only"))
                assertEquals(200,edited.statusCode());assertEquals(mine,json(edited).path("linkedWorkId").asString())
                assertEquals(2,json(anonymous(wiki)).path("cards").size())

                // 관계 저장소가 현재 상태를 보증하지 못하면 카드는 그대로 두고 unavailable로 알린다(500이 아니다).
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"UPDATE worldstudio.relationship_state SET completed=false WHERE world_id='$world'") }
                val pending=anonymous(wiki);assertEquals(200,pending.statusCode())
                assertEquals("unavailable",json(pending).path("relationshipStatus").asString());assertEquals(0,json(pending).path("relationships").size())
                assertEquals(2,json(pending).path("cards").size())
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"UPDATE worldstudio.relationship_state SET completed=true WHERE world_id='$world'") }
                assertEquals("current",json(anonymous(wiki)).path("relationshipStatus").asString())

                // 해제하면 독자 위키가 비고, 그 세계관을 다른 작품에 연결할 수 있다.
                val unlinked=link(mine,null);assertEquals(200,unlinked.statusCode());assertTrue(json(unlinked).path("worldId").isNull)
                val empty=json(anonymous(wiki))
                assertTrue(empty.path("worldId").isNull);assertEquals(0,empty.path("cards").size());assertEquals(2,empty.path("upto").asInt())
                assertTrue(json(send("$studios/$world")).path("linkedWorkId").isNull)
                assertEquals(200,link(another,world).statusCode())
                assertEquals(409,link(mine,world).statusCode())

                // 작품을 삭제하면 연결이 풀려(UNIQUE 칼럼을 삭제된 작품이 쥐지 않는다) 그 세계관을 다시 연결할 수 있고, 삭제된 작품의 위키는 404다.
                assertEquals(204,send("/api/v1/works/$another",method="DELETE").statusCode())
                assertTrue(json(send("$studios/$world")).path("linkedWorkId").isNull)
                assertEquals(404,anonymous("/api/v1/public/works/$another/world-cards").statusCode())
                assertEquals(200,link(mine,world).statusCode())
                assertEquals(2,json(anonymous(wiki)).path("cards").size())
            }
        }
    }
}
