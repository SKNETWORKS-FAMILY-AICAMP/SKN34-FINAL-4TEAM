package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.world.client.InitialWorldCallFailure
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.client.dto.WorldReviewAiCharacterDocs
import ai.storyfork.content.world.client.dto.WorldReviewAiRequest
import ai.storyfork.content.world.service.dto.*
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import tools.jackson.databind.json.JsonMapper

/** Hosted CI only: real Content HTTP/CSRF/security, PostgreSQL and Neo4j; Core verification and the AI service are isolated test doubles. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldReviewHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Doubles {
        @Bean @Primary fun reviewTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
        /** 실제 AI 서비스를 부르지 않는다. 보낸 요청은 mockingDetails로, 응답과 실패는 doReturn·doThrow로 정한다. */
        @Bean @Primary fun reviewTestAiClient():InitialWorldExtractionClient=mock(InitialWorldExtractionClient::class.java)
    }

    @Test fun `the owner reviews the saved draft through the AI double and nothing is written or cached`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Doubles::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val ai=ctx.getBean(InitialWorldExtractionClient::class.java)
                val owner=UUID.randomUUID();val other=UUID.randomUUID()
                for(id in listOf(owner,other)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                val base="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}/api/v1/world-studios"
                fun send(path:String="",actor:UUID?=owner,method:String="GET",body:Any?=null,csrf:Boolean=true):HttpResponse<String> {
                    val request=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json")
                    if(actor!=null)request.header("Authorization","Bearer $actor")
                    if(csrf&&method!="GET")request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null)HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
                }
                fun review(world:UUID,actor:UUID?=owner,body:Any?=WorldReviewRequest(true),csrf:Boolean=true)=send("/$world/reviews",actor,"POST",body,csrf)
                val placeholder=WorldReviewAiRequest("","",emptyList(),emptyList())
                fun aiAnswers(json:String)=doReturn(json).`when`(ai).review(any(WorldReviewAiRequest::class.java) ?: placeholder)
                fun aiFails(failure:InitialWorldCallFailure)=doThrow(failure).`when`(ai).review(any(WorldReviewAiRequest::class.java) ?: placeholder)
                fun aiCalls()=mockingDetails(ai).invocations.count { it.method.name=="review" }

                // 인물 둘(하나는 옛 memory가 섞인 문서)·규칙 하나·문서가 커서 4,000자를 넘는 인물 하나, 관계 하나.
                val create=CreateWorldRequest("검토할 세계관","세계관 설명")
                assertEquals(200,send(method="POST",body=create).statusCode())
                val hero=CardPayload(UUID.randomUUID(),"영웅","영웅 본문","character","basic",semanticMetadata=mapOf(
                    "characterDocs" to mapOf("soul" to "느긋한 말투","goal" to "복수","memory" to "옛 기억","episodes" to mapOf("0" to "비밀"))))
                val rival=CardPayload(UUID.randomUUID(),"라이벌","라이벌 본문","character","basic")
                val rule=CardPayload(UUID.randomUUID(),"규칙","규칙 본문","rule","basic")
                val bloated=CardPayload(UUID.randomUUID(),"문서가 큰 인물","가".repeat(3000),"character","basic",semanticMetadata=mapOf(
                    "characterDocs" to mapOf("soul" to "나".repeat(1200),"goal" to "","episodes" to emptyMap<String,String>())))
                val relation=RelationshipPayload(UUID.randomUUID(),hero.id,rival.id,"emotional","",label="적대",direction="directed",polarity="denied")
                assertEquals(200,send("/${create.id}/draft",method="PUT",
                    body=EditWorldDraftRequest(0,create.name,"세계관 설명",listOf(hero,rival,rule,bloated),listOf(relation),"review-edit",true)).statusCode())

                aiAnswers(mapper.writeValueAsString(mapOf("findings" to listOf(mapOf(
                    "cardIds" to listOf(hero.id.toString(),rival.id.toString()),"kind" to "contradiction","message" to "영웅과 라이벌의 설정이 어긋나요.",
                    "fix" to mapOf("cardId" to hero.id.toString(),"target" to "goal","episode" to null,"text" to "새 목표"))),
                    "reviewedCards" to 3,"model" to "gpt-6-luna")))
                val reviewed=review(create.id)
                assertEquals(200,reviewed.statusCode(),reviewed.body())
                assertTrue(reviewed.headers().firstValue("Cache-Control").orElse("").contains("no-store"))
                val body=mapper.readTree(reviewed.body())
                assertEquals(1,body.path("draftRevision").asInt())
                assertEquals(3,body.path("reviewedCards").asInt());assertEquals(4,body.path("totalCards").asInt())
                assertEquals("gpt-6-luna",body.path("model").asString())
                val finding=body.path("findings").get(0)
                assertEquals(listOf(hero.id.toString(),rival.id.toString()),finding.path("cardIds").values().map { it.asString() })
                assertEquals("goal",finding.path("fix").path("target").asString());assertEquals("새 목표",finding.path("fix").path("text").asString())
                assertFalse(finding.path("fix").has("episode"))

                // AI로 간 요청: 활성 카드 중 한도 안의 셋뿐, 인물 문서는 soul·goal·episodes만(옛 memory 없음), 관계는 양 끝을 보낸 것만.
                val sent=mockingDetails(ai).invocations.last().arguments[0] as WorldReviewAiRequest
                assertEquals("검토할 세계관",sent.worldName)
                assertEquals(setOf("영웅","라이벌","규칙"),sent.cards.map { it.title }.toSet())
                assertEquals(WorldReviewAiCharacterDocs("느긋한 말투","복수",mapOf("0" to "비밀")),sent.cards.single { it.title=="영웅" }.characterDocs)
                assertEquals("denied",sent.relationships.single().polarity)
                val calls=aiCalls();assertEquals(1,calls)

                // 동의가 true가 아니면(없는 본문 포함) 422이고 AI를 부르지 않는다.
                for(refusal in listOf<Any?>(WorldReviewRequest(false),emptyMap<String,Any>(),null)) {
                    val refused=review(create.id,body=refusal)
                    assertEquals(422,refused.statusCode());assertEquals("AI_CONSENT_REQUIRED",mapper.readTree(refused.body()).path("code").asString())
                }
                // 소유자만, 없는 세계관·남의 세계관은 같은 404, 인증과 CSRF는 기존 규칙이다.
                for(unreadable in listOf(review(create.id,other),review(UUID.randomUUID()))) {
                    assertEquals(404,unreadable.statusCode());assertEquals("WORLD_NOT_FOUND",mapper.readTree(unreadable.body()).path("code").asString())
                }
                assertEquals(401,review(create.id,null).statusCode())
                assertEquals(403,review(create.id,csrf=false).statusCode())
                assertEquals(calls,aiCalls())

                // AI 실패는 성공이나 빈 결과로 숨기지 않고 상태와 코드를 그대로 전한다.
                for((failure,status) in listOf(InitialWorldCallFailure("AI_TIMEOUT",true) to 504,InitialWorldCallFailure("AI_NOT_CONFIGURED",false) to 503,
                    InitialWorldCallFailure("AI_RESPONSE_UNCONFIRMED",true) to 502)) {
                    aiFails(failure)
                    val failed=review(create.id)
                    assertEquals(status,failed.statusCode());assertEquals(failure.code,mapper.readTree(failed.body()).path("code").asString())
                    assertTrue(mapper.readTree(failed.body()).path("detail").asString().isNotBlank())
                }
                aiAnswers("""{"findings":[{"cardIds":["${UUID.randomUUID()}"],"kind":"other","message":"모르는 카드"}],"model":"m"}""")
                val invalid=review(create.id)
                assertEquals(502,invalid.statusCode());assertEquals("AI_OUTPUT_INVALID",mapper.readTree(invalid.body()).path("code").asString())

                // 카드가 없는 세계관은 AI를 부르지 않고 빈 검토다.
                val empty=CreateWorldRequest("빈 세계관")
                assertEquals(200,send(method="POST",body=empty).statusCode())
                val before=aiCalls()
                val none=mapper.readTree(review(empty.id).body())
                assertEquals(0,none.path("reviewedCards").asInt());assertEquals(0,none.path("totalCards").asInt())
                assertEquals(0,none.path("findings").size());assertEquals("",none.path("model").asString())
                assertEquals(before,aiCalls())

                // 검토는 아무것도 저장하지 않는다: 초안 revision은 편집 한 번 뒤 그대로다.
                assertEquals(1,mapper.readTree(send("/${create.id}").body()).path("draftRevision").asInt())
            }
        }
    }
}
