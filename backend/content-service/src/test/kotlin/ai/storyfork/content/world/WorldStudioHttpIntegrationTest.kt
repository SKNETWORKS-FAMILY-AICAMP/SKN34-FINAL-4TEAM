package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
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
import tools.jackson.databind.json.JsonMapper

/** Hosted CI only: real Content HTTP/CSRF, PostgreSQL and Neo4j; Core verification is an isolated test double. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldStudioHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Auth {
        @Bean @Primary fun studioTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
    }
    @Test fun `verified owner current relation save is isolated authenticated and never a historical snapshot`() {
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
                val base="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}/api/v1/world-studios"
                fun send(path:String="",actor:UUID?=owner,method:String="GET",body:Any?=null,csrf:Boolean=true):HttpResponse<String> {
                    val request=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json")
                    if(actor!=null)request.header("Authorization","Bearer $actor")
                    if(csrf&&method!="GET")request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null)HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
                }
                assertEquals(401,send(actor=null).statusCode())
                assertEquals(403,send(method="POST",body=CreateWorldRequest("no csrf"),csrf=false).statusCode())
                val create=CreateWorldRequest("비공개 세계관")
                val created=send(method="POST",body=create);assertEquals(200,created.statusCode())
                assertEquals(404,send("/${create.id}",other).statusCode());assertEquals(200,send("/${create.id}").statusCode())
                val a=CardPayload(UUID.randomUUID(),"첫 인물","비공개 원문","character","basic")
                val b=a.copy(id=UUID.randomUUID(),title="둘째 인물")
                val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"emotional","자유 관계 원문",direction="directed",polarity="denied")
                val edit=EditWorldDraftRequest(0,create.name,"",listOf(a,b),listOf(relation),"http-save",true)
                val saved=send("/${create.id}/draft",method="PUT",body=edit);assertEquals(200,saved.statusCode())
                assertEquals("자유 관계 원문",mapper.readTree(saved.body()).path("relationships").get(0).path("body").asText())
                assertEquals(saved.body(),send("/${create.id}/draft",method="PUT",body=edit).body())
                val conflict=send("/${create.id}/draft",method="PUT",body=edit.copy(name="다른 입력"))
                assertEquals(409,conflict.statusCode());assertFalse(conflict.body().contains("자유 관계 원문"))
                assertEquals("WORLD_CONFLICT",mapper.readTree(conflict.body()).path("code").asText())
                val stale=send("/${create.id}/draft",method="PUT",body=edit.copy(key="stale"))
                assertEquals(409,stale.statusCode());assertEquals("WORLD_WRITE_REJECTED",mapper.readTree(stale.body()).path("code").asText())
                val another=CreateWorldRequest("다른 세계관")
                assertEquals(200,send(method="POST",body=another).statusCode())
                val collision=send("/${another.id}/draft",method="PUT",body=EditWorldDraftRequest(0,another.name,"",relationships=listOf(relation.copy(sourceCardId=null,targetCardId=null)),key="collision"))
                assertEquals(409,collision.statusCode());assertEquals("WORLD_WRITE_REJECTED",mapper.readTree(collision.body()).path("code").asText())
                val unchanged=send("/${another.id}")
                assertEquals(200,unchanged.statusCode());assertEquals(0,mapper.readTree(unchanged.body()).path("draftRevision").asInt())
                val invalid=send("/${create.id}/draft",method="PUT",body=edit.copy(expectedDraftRevision=1,key="bad",relationships=listOf(relation.copy(targetCardId=UUID.randomUUID()))))
                assertEquals(422,invalid.statusCode())
                val revision=send("/${create.id}/revisions",method="POST",body=SaveWorldRequest(1,"cards"))
                assertEquals(200,revision.statusCode());assertTrue(mapper.readTree(revision.body()).path("relationships").isNull)
                assertEquals("not_recorded",mapper.readTree(revision.body()).path("relationshipStatus").asText())
                db.connect().use { c ->
                    assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.relationship_draft"))
                    assertEquals(listOf(owner.toString()),WorldStudioPostgresFixture.rows(c,"SELECT owner_subject::text FROM worldstudio.world WHERE id='${create.id}'"))
                }
            }
        }
    }
}
