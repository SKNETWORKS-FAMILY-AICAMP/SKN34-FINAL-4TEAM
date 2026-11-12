package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import ai.storyfork.content.fixture.CsrfFixture
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

/** Hosted CI only: real Content HTTP/CSRF/security, PostgreSQL and Neo4j; Core verification and nicknames are an isolated test double. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class PublicWorldHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Auth {
        @Bean @Primary fun publicWorldTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
    }

    @Test fun `publication is per world, anonymous readers see only saved cards and current relations, and private hides at once`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Auth::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val owner=UUID.randomUUID();val other=UUID.randomUUID()
                for(id in listOf(owner,other)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                `when`(core.nicknames(NicknamesPayload(listOf(owner.toString())))).thenReturn(NicknamesResponse(mapOf(owner.toString() to "공개 작가")))
                val host="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}"
                val studios="/api/v1/world-studios";val publics="/api/v1/public/world-studios"
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
                fun publish(visibility:String,genre:String?,actor:UUID?=owner,csrf:Boolean=true,id:UUID)=
                    send("$studios/$id/publication",actor,"PUT",PublicationRequest(visibility,genre),csrf)

                val create=CreateWorldRequest("공개할 세계관","첫 설명")
                assertEquals(200,send(studios,method="POST",body=create).statusCode())
                val a=CardPayload(UUID.randomUUID(),"첫 인물","공개 원문","character","basic",aliases=listOf("별칭"),tags=listOf("태그"))
                val b=a.copy(id=UUID.randomUUID(),title="둘째 인물")
                val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"emotional","관계 설명 원문",label="동료",direction="directed")
                assertEquals(200,send("$studios/${create.id}/draft",method="PUT",body=EditWorldDraftRequest(0,create.name,"첫 설명",listOf(a,b),listOf(relation),"public-edit",true)).statusCode())

                // 기본은 비공개이고, 공개로 설정해도 저장 버전이 없으면(초안뿐이면) 목록·상세에 나오지 않는다.
                assertEquals(404,anonymous("$publics/${create.id}").statusCode())
                assertEquals(0,json(anonymous(publics)).path("total").asInt())
                val draftOnly=publish("public","fantasy",id=create.id)
                assertEquals(200,draftOnly.statusCode())
                assertFalse(json(draftOnly).path("listed").asBoolean());assertTrue(json(draftOnly).path("publishedAt").isString)
                assertEquals(404,anonymous("$publics/${create.id}").statusCode())
                assertEquals(0,json(anonymous(publics)).path("total").asInt())

                // 소유자만, 값 오류는 422, 인증·CSRF는 기존 규칙 그대로다.
                assertEquals(404,publish("private",null,actor=other,id=create.id).statusCode())
                assertEquals(401,publish("private",null,actor=null,id=create.id).statusCode())
                assertEquals(403,publish("private",null,csrf=false,id=create.id).statusCode())
                assertEquals(422,publish("friends",null,id=create.id).statusCode())
                assertEquals(422,publish("public","romcom",id=create.id).statusCode())
                assertTrue(listOf(401,403).contains(send(publics,actor=null,method="POST",body=emptyMap<String,String>()).statusCode()))

                // 저장 버전이 생기면 비로그인으로도 마지막 저장 버전의 카드와 현재 관계가 읽기 전용으로 보인다.
                assertEquals(200,send("$studios/${create.id}/revisions",method="POST",body=SaveWorldRequest(1,"cards")).statusCode())
                val detail=anonymous("$publics/${create.id}");assertEquals(200,detail.statusCode())
                val view=json(detail)
                assertEquals(create.id.toString(),view.path("id").asString());assertEquals("공개할 세계관",view.path("name").asString())
                assertEquals("첫 설명",view.path("description").asString());assertEquals("fantasy",view.path("genre").asString())
                assertEquals("공개 작가",view.path("authorNickname").asString());assertEquals(1,view.path("revisionNo").asInt())
                assertTrue(view.path("publishedAt").isString);assertEquals("current",view.path("relationshipStatus").asString())
                assertEquals(2,view.path("cards").size())
                val shown=view.path("cards").values().first { it.path("id").asString()==a.id.toString() }
                assertEquals("첫 인물",shown.path("title").asString());assertEquals("공개 원문",shown.path("text").asString())
                assertEquals("character",shown.path("cardType").asString())
                assertEquals("별칭",shown.path("aliases").get(0).asString());assertEquals("태그",shown.path("tags").get(0).asString())
                assertEquals(1,view.path("relationships").size())
                val edge=view.path("relationships").get(0)
                assertEquals(relation.id.toString(),edge.path("id").asString());assertEquals(a.id.toString(),edge.path("sourceCardId").asString())
                assertEquals(b.id.toString(),edge.path("targetCardId").asString());assertEquals("동료",edge.path("label").asString())
                assertFalse(detail.body().contains("관계 설명 원문"))

                // 목록: 카드·관계 수, 작가 닉네임, 장르 필터, 잘못된 쿼리는 422다.
                val all=json(anonymous(publics));assertEquals(1,all.path("total").asInt());assertEquals(0,all.path("page").asInt());assertEquals(24,all.path("size").asInt())
                val item=all.path("items").get(0)
                assertEquals(create.id.toString(),item.path("id").asString());assertEquals(2,item.path("cardCount").asInt());assertEquals(1,item.path("relationshipCount").asInt())
                assertEquals("공개 작가",item.path("authorNickname").asString());assertEquals("fantasy",item.path("genre").asString())
                assertEquals(1,json(anonymous("$publics?genre=fantasy&page=0&size=24")).path("items").size())
                assertEquals(0,json(anonymous("$publics?genre=sf")).path("items").size())
                assertEquals(0,json(anonymous("$publics?page=1&size=1")).path("items").size())
                assertEquals(422,anonymous("$publics?genre=romcom").statusCode());assertEquals(422,anonymous("$publics?size=0").statusCode())
                assertEquals(422,anonymous("$publics?page=-1").statusCode())
                assertEquals(404,anonymous("$publics/${UUID.randomUUID()}").statusCode())

                // 저장하지 않은 수정(새 카드·새 관계)은 공개되지 않는다.
                val draftCard=a.copy(id=UUID.randomUUID(),title="초안에만 있는 인물")
                val draftRelation=RelationshipPayload(UUID.randomUUID(),a.id,draftCard.id,"structural","초안 관계",label="초안에만 있는 관계")
                assertEquals(200,send("$studios/${create.id}/draft",method="PUT",body=EditWorldDraftRequest(2,"수정 중인 이름","수정 중",listOf(draftCard),listOf(draftRelation),"draft-only")).statusCode())
                val saved=json(anonymous("$publics/${create.id}"))
                assertEquals("공개할 세계관",saved.path("name").asString());assertEquals(2,saved.path("cards").size());assertEquals(1,saved.path("relationships").size())

                // 소유자의 목록·상세에도 공개 설정이 보인다.
                val mine=json(send(studios)).values().first { it.path("worldId").asString()==create.id.toString() }
                assertEquals("public",mine.path("visibility").asString());assertEquals("fantasy",mine.path("genre").asString())
                assertEquals("public",json(send("$studios/${create.id}")).path("visibility").asString())

                // 관계 저장소가 현재 상태를 보증하지 못하면 카드는 그대로 두고 unavailable로 알린다(500이 아니다).
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"UPDATE worldstudio.relationship_state SET completed=false WHERE world_id='${create.id}'") }
                val pending=anonymous("$publics/${create.id}");assertEquals(200,pending.statusCode())
                assertEquals("unavailable",json(pending).path("relationshipStatus").asString());assertEquals(0,json(pending).path("relationships").size())
                assertEquals(2,json(pending).path("cards").size())
                assertEquals(0,json(anonymous(publics)).path("items").get(0).path("relationshipCount").asInt())
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"UPDATE worldstudio.relationship_state SET completed=true WHERE world_id='${create.id}'") }
                assertEquals("current",json(anonymous("$publics/${create.id}")).path("relationshipStatus").asString())

                // 비공개로 바꾸면 즉시 목록·상세에서 빠지고, 다시 공개하면 돌아온다(장르는 요청 그대로).
                val hidden=publish("private","fantasy",id=create.id)
                assertEquals(200,hidden.statusCode());assertTrue(json(hidden).path("publishedAt").isNull);assertFalse(json(hidden).path("listed").asBoolean())
                assertEquals(404,anonymous("$publics/${create.id}").statusCode())
                assertEquals(0,json(anonymous(publics)).path("total").asInt())
                val again=publish("public",null,id=create.id)
                assertTrue(json(again).path("listed").asBoolean());assertTrue(json(again).path("genre").isNull)
                assertTrue(json(anonymous("$publics/${create.id}")).path("genre").isNull)
                assertEquals(1,json(anonymous(publics)).path("total").asInt())
            }
        }
    }
}
