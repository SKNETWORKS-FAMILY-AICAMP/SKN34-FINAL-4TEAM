package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.world.service.dto.*
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.imageio.ImageIO
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** Hosted CI only: real Content HTTP/CSRF/security, PostgreSQL and Neo4j; Core verification and the object store (MinIO) are isolated test doubles. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldCoverHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Doubles {
        /** 객체 저장소 대역이 들고 있는 객체(키 → 바이트). 거절·교체·삭제 뒤 남은 객체를 테스트가 센다. */
        val objects=ConcurrentHashMap<String,ByteArray>()
        @Bean @Primary fun worldCoverTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
        @Bean @Primary fun worldCoverTestStorage():AttachmentStorageClient {
            val storage=mock(AttachmentStorageClient::class.java)
            doAnswer { objects[it.getArgument<String>(0)]=it.getArgument<AttachmentObjectPayload>(1).bytes; Unit }
                .`when`(storage).upload(anyString(),any(AttachmentObjectPayload::class.java) ?: AttachmentObjectPayload(ByteArray(0),""))
            `when`(storage.read(anyString())).thenAnswer { AttachmentObjectResult(objects.getValue(it.getArgument<String>(0))) }
            doAnswer { objects.remove(it.getArgument<String>(0)); Unit }.`when`(storage).delete(anyString())
            return storage
        }
    }

    private fun image(format:String):ByteArray=ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2,2,BufferedImage.TYPE_INT_RGB),format,it) }.toByteArray()

    /** RIFF 컨테이너 구조만 맞춘 최소 WebP다(JDK가 WebP를 못 읽어 서버도 구조만 검사한다). */
    private val webp="RIFF".toByteArray()+byteArrayOf(22,0,0,0)+"WEBPVP8L".toByteArray()+byteArrayOf(10,0,0,0)+ByteArray(10)

    @Test fun `owner uploads replaces and deletes a cover, and anonymous readers get it only while the world is listed`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Doubles::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val objects=ctx.getBean(Doubles::class.java).objects
                val owner=UUID.randomUUID();val other=UUID.randomUUID()
                for(id in listOf(owner,other)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                // 공개 목록·상세는 작가 표시명을 Core에서 읽는다.
                `when`(core.nicknames(NicknamesPayload(listOf(owner.toString())))).thenReturn(NicknamesResponse(mapOf(owner.toString() to "표지 작가")))
                val host="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}"
                val studios="/api/v1/world-studios";val publics="/api/v1/public/world-studios"
                fun call(path:String,actor:UUID?=owner,method:String="GET",body:ByteArray?=null,type:String="application/json",csrf:Boolean=true):HttpResponse<ByteArray> {
                    val request=HttpRequest.newBuilder(URI.create(host+path))
                    if(body!=null)request.header("Content-Type",type)
                    if(actor!=null)request.header("Authorization","Bearer $actor")
                    if(csrf&&method!="GET")request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null)HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofByteArray(body))
                    return client.send(request.build(),HttpResponse.BodyHandlers.ofByteArray())
                }
                fun json(response:HttpResponse<ByteArray>):JsonNode=mapper.readTree(response.body())
                fun send(path:String,method:String,payload:Any,actor:UUID?=owner)=call(path,actor,method,mapper.writeValueAsString(payload).toByteArray())
                /** 파트 이름이 `file`인 multipart다. 서버는 보낸 형식(octet-stream)·파일명을 믿지 않고 바이트로 판단한다. */
                fun upload(id:UUID,bytes:ByteArray,actor:UUID?=owner,csrf:Boolean=true,part:String="file"):HttpResponse<ByteArray> {
                    val boundary="cover-${UUID.randomUUID()}"
                    val body="--$boundary\r\nContent-Disposition: form-data; name=\"$part\"; filename=\"cover.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n".toByteArray()+
                        bytes+"\r\n--$boundary--\r\n".toByteArray()
                    return call("$studios/$id/cover",actor,"PUT",body,"multipart/form-data; boundary=$boundary",csrf)
                }
                fun header(response:HttpResponse<ByteArray>,name:String)=response.headers().firstValue(name).orElse("")
                fun mine(id:UUID):JsonNode=json(call(studios)).values().first { it.path("worldId").asString()==id.toString() }
                fun publish(id:UUID,visibility:String,genre:String?)=send("$studios/$id/publication","PUT",PublicationRequest(visibility,genre))

                // 세계관 하나를 만들고 카드 둘을 저장한다. 확정 버전은 아직 없다.
                val create=CreateWorldRequest("표지 세계관","첫 설명")
                assertEquals(200,send(studios,"POST",create).statusCode())
                val a=CardPayload(UUID.randomUUID(),"첫 인물","공개 원문","character","basic",aliases=listOf("별칭"),tags=listOf("태그"))
                val b=a.copy(id=UUID.randomUUID(),title="둘째 인물")
                val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"emotional","관계 설명 원문",label="동료",direction="directed")
                assertEquals(200,send("$studios/${create.id}/draft","PUT",EditWorldDraftRequest(0,create.name,"첫 설명",listOf(a,b),listOf(relation),"cover-edit",true)).statusCode())
                val cover="$studios/${create.id}/cover";val publicCover="$publics/${create.id}/cover"

                // 표지가 없으면 소유자 읽기는 404이고 hasCover는 false다.
                assertEquals(404,call(cover).statusCode())
                assertFalse(json(call("$studios/${create.id}")).path("hasCover").asBoolean())
                assertFalse(mine(create.id).path("hasCover").asBoolean())

                // 인증·CSRF·소유자·값 검사: 거절된 업로드는 객체 저장소에 아무것도 남기지 않는다.
                val png=image("png")
                assertEquals(401,upload(create.id,png,actor=null).statusCode())
                assertEquals(403,upload(create.id,png,csrf=false).statusCode())
                assertEquals(404,upload(create.id,png,actor=other).statusCode())
                assertEquals(422,upload(create.id,"이미지가 아닌 글".toByteArray()).statusCode())
                assertEquals(422,upload(create.id,png,part="other").statusCode())
                val tooBig=upload(create.id,ByteArray(5*1024*1024+1))
                assertEquals(422,tooBig.statusCode());assertEquals("WORLD_INPUT_INVALID",json(tooBig).path("code").asString())
                assertTrue(json(tooBig).path("detail").isString)
                assertEquals(0,objects.size)

                // 저장하면 소유자가 같은 바이트를 캐시 없이 읽고, 남은 읽기는 막힌다.
                val stored=upload(create.id,png)
                assertEquals(200,stored.statusCode());assertEquals(create.id.toString(),json(stored).path("worldId").asString())
                assertTrue(json(stored).path("hasCover").asBoolean());assertEquals(1,objects.size)
                val own=call(cover)
                assertEquals(200,own.statusCode());assertArrayEquals(png,own.body())
                assertEquals("image/png",header(own,"Content-Type"));assertEquals("private, no-store",header(own,"Cache-Control"))
                assertEquals("nosniff",header(own,"X-Content-Type-Options"))
                assertEquals(404,call(cover,actor=other).statusCode());assertEquals(401,call(cover,actor=null).statusCode())
                assertTrue(json(call("$studios/${create.id}")).path("hasCover").asBoolean());assertTrue(mine(create.id).path("hasCover").asBoolean())
                assertEquals(400,call("$studios/not-a-uuid/cover").statusCode())

                // 공개 전에는 404이고, 공개로 설정해도 확정 버전이 없으면 404다.
                assertEquals(404,call(publicCover,actor=null).statusCode())
                assertEquals(200,publish(create.id,"public","fantasy").statusCode())
                assertEquals(404,call(publicCover,actor=null).statusCode())
                // 확정 버전이 생기면 비로그인으로도 같은 표지를 캐시 없이 읽고 목록·상세가 hasCover로 알린다.
                assertEquals(200,send("$studios/${create.id}/revisions","POST",SaveWorldRequest(1,"cover-save")).statusCode())
                val shown=call(publicCover,actor=null)
                assertEquals(200,shown.statusCode());assertArrayEquals(png,shown.body());assertEquals("image/png",header(shown,"Content-Type"))
                assertEquals("private, no-store",header(shown,"Cache-Control"));assertEquals("nosniff",header(shown,"X-Content-Type-Options"))
                assertTrue(json(call("$publics/${create.id}",actor=null)).path("hasCover").asBoolean())
                assertTrue(json(call(publics,actor=null)).path("items").get(0).path("hasCover").asBoolean())

                // 교체하면 새 바이트·형식이 보이고 이전 객체는 지워진다. WebP도 받는다.
                val jpeg=image("jpeg")
                assertEquals(200,upload(create.id,jpeg).statusCode());assertEquals(1,objects.size)
                val replaced=call(publicCover,actor=null)
                assertArrayEquals(jpeg,replaced.body());assertEquals("image/jpeg",header(replaced,"Content-Type"))
                assertEquals(200,upload(create.id,webp).statusCode());assertEquals(1,objects.size)
                assertEquals("image/webp",header(call(publicCover,actor=null),"Content-Type"))

                // 비공개로 바꾸면 공개 표지는 바로 404이고 소유자는 계속 읽는다.
                assertEquals(200,publish(create.id,"private",null).statusCode())
                assertEquals(404,call(publicCover,actor=null).statusCode());assertEquals(200,call(cover).statusCode())

                // 삭제: 인증·CSRF·소유자 규칙, 참조와 객체를 모두 지우고, 표지가 없어도 204다.
                assertEquals(401,call(cover,actor=null,method="DELETE").statusCode())
                assertEquals(403,call(cover,method="DELETE",csrf=false).statusCode())
                assertEquals(404,call(cover,actor=other,method="DELETE").statusCode())
                assertEquals(204,call(cover,method="DELETE").statusCode())
                assertEquals(0,objects.size);assertEquals(404,call(cover).statusCode())
                assertFalse(json(call("$studios/${create.id}")).path("hasCover").asBoolean());assertFalse(mine(create.id).path("hasCover").asBoolean())
                assertEquals(204,call(cover,method="DELETE").statusCode())

                // 확정 버전이 없는 세계관은 표지를 올리고 공개해도 비로그인에는 404다. 없는 세계관·UUID가 아닌 값도 마찬가지다.
                val draftOnly=CreateWorldRequest("확정 전 세계관","설명")
                assertEquals(200,send(studios,"POST",draftOnly).statusCode())
                assertEquals(200,upload(draftOnly.id,png).statusCode())
                assertEquals(200,publish(draftOnly.id,"public",null).statusCode())
                assertEquals(404,call("$publics/${draftOnly.id}/cover",actor=null).statusCode())
                assertEquals(404,call("$publics/${UUID.randomUUID()}/cover",actor=null).statusCode())
                assertEquals(400,call("$publics/not-a-uuid/cover",actor=null).statusCode())
            }
        }
    }
}
