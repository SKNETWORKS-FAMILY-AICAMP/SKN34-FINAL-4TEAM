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
                // 회차(episode)는 선택 쿼리다: 1 이상의 정수만, 값 오류는 422다(관계는 1화에 기록됐다).
                assertEquals("자유 관계 원문",mapper.readTree(send("/${create.id}?episode=1").body()).path("relationships").get(0).path("body").asText())
                for(bad in listOf("0","abc")) {
                    val invalidEpisode=send("/${create.id}?episode=$bad")
                    assertEquals(422,invalidEpisode.statusCode());assertEquals("WORLD_INPUT_INVALID",mapper.readTree(invalidEpisode.body()).path("code").asText())
                }
                val stale=send("/${create.id}/draft",method="PUT",body=edit.copy(key="stale"))
                assertEquals(409,stale.statusCode());assertEquals("WORLD_WRITE_REJECTED",mapper.readTree(stale.body()).path("code").asText())
                val another=CreateWorldRequest("다른 세계관")
                assertEquals(200,send(method="POST",body=another).statusCode())
                // DEC-51: 끝이 빈 관계는 저장할 수 없어, 다른 세계관의 관계 ID 재사용도 이 세계관의 실제 카드 둘로 시도한다.
                val foreignA=a.copy(id=UUID.randomUUID(),title="다른 세계관의 인물");val foreignB=a.copy(id=UUID.randomUUID(),title="다른 세계관의 장소")
                val collision=send("/${another.id}/draft",method="PUT",body=EditWorldDraftRequest(0,another.name,"",listOf(foreignA,foreignB),listOf(relation.copy(sourceCardId=foreignA.id,targetCardId=foreignB.id)),"collision"))
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
    @Test fun `the owner puts the draft cards back to a confirmed version over HTTP without a new revision and nobody else can`() {
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
                fun send(path:String="",actor:UUID?=owner,method:String="GET",body:Any?=null):HttpResponse<String> {
                    val request=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json").header("Authorization","Bearer $actor")
                    if(method!="GET")request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null)HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
                }
                val create=CreateWorldRequest("되돌릴 세계관")
                assertEquals(200,send(method="POST",body=create).statusCode())
                val a=CardPayload(UUID.randomUUID(),"가람","확정 당시 내용","character","basic",visibility="public")
                val b=a.copy(id=UUID.randomUUID(),title="나래",visibility="private")
                assertEquals(200,send("/${create.id}/draft",method="PUT",body=EditWorldDraftRequest(0,create.name,"",listOf(a),key="restore-e1")).statusCode())
                val sealed=send("/${create.id}/revisions",method="POST",body=SaveWorldRequest(1,"restore-save"));assertEquals(200,sealed.statusCode())
                val revisionId=mapper.readTree(sealed.body()).path("revisionId").asString()
                // 확정 뒤 초안의 카드를 고치고 카드를 더한다(저장이 초안 revision을 올려 다음은 2다).
                assertEquals(200,send("/${create.id}/draft",method="PUT",body=EditWorldDraftRequest(2,create.name,"",listOf(a.copy(body="고친 내용"),b),key="restore-e2")).statusCode())
                val restore="/${create.id}/revisions/$revisionId/restore"
                // 남의 세계관·모르는 버전은 404, 낡은 초안 revision은 409이고 아무것도 바뀌지 않는다.
                assertEquals(404,send(restore,other,"POST",RestoreWorldRequest(3)).statusCode())
                assertEquals(404,send("/${create.id}/revisions/${UUID.randomUUID()}/restore",method="POST",body=RestoreWorldRequest(3)).statusCode())
                val stale=send(restore,method="POST",body=RestoreWorldRequest(2))
                assertEquals(409,stale.statusCode());assertEquals("WORLD_CONFLICT",mapper.readTree(stale.body()).path("code").asText())
                assertEquals(3,mapper.readTree(send("/${create.id}").body()).path("draftRevision").asInt())
                // 되돌리면 그 버전의 카드가 초안이 되고 그 버전에 없던 카드는 삭제 상태가 된다. 새 확정 버전은 만들지 않는다.
                val restored=send(restore,method="POST",body=RestoreWorldRequest(3));assertEquals(200,restored.statusCode())
                val view=mapper.readTree(restored.body());val cards=view.path("cards").values().associateBy { it.path("id").asString() }
                assertEquals(4,view.path("draftRevision").asInt())
                assertEquals("확정 당시 내용",cards.getValue(a.id.toString()).path("body").asString());assertEquals("removed",cards.getValue(b.id.toString()).path("lifecycle").asString())
                assertEquals(1,mapper.readTree(send("/${create.id}/revisions").body()).size())
                // 사라질 설정에 현재 관계가 이어져 있으면 409 WORLD_RESTORE_BLOCKED로 거절하고 설정 이름을 알린다.
                val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"structural","동료 관계",label="동료")
                assertEquals(200,send("/${create.id}/draft",method="PUT",body=EditWorldDraftRequest(4,create.name,"",listOf(b),listOf(relation),"restore-e3")).statusCode())
                val blocked=send(restore,method="POST",body=RestoreWorldRequest(5))
                assertEquals(409,blocked.statusCode());assertEquals("WORLD_RESTORE_BLOCKED",mapper.readTree(blocked.body()).path("code").asText())
                assertTrue(mapper.readTree(blocked.body()).path("detail").asString().contains("나래"))
                assertEquals(5,mapper.readTree(send("/${create.id}").body()).path("draftRevision").asInt())
            }
        }
    }
}
