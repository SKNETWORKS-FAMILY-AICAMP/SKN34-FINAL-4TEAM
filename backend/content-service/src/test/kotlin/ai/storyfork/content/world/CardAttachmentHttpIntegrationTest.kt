package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
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
import javax.sql.DataSource
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

/**
 * Hosted CI only: 세계관 스튜디오 설정 카드 첨부(#735)를 실제 Content HTTP/CSRF/보안·PostgreSQL(첨부 V2·WorldStudio)·Neo4j로 확인한다.
 * Core 회원 검증·닉네임과 객체 저장소(MinIO)는 대역이다. 옛 작품 설정 첨부는 SettingAttachmentHttpTest가 그대로 확인한다.
 */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class CardAttachmentHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Doubles {
        /** 객체 저장소 대역이 들고 있는 객체(키 → 바이트). */
        val objects=ConcurrentHashMap<String,ByteArray>()
        @Bean @Primary fun cardAttachmentTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
        @Bean @Primary fun cardAttachmentTestCoreNicknames():CoreNicknameService=mock(CoreNicknameService::class.java)
        @Bean @Primary fun cardAttachmentTestStorage():AttachmentStorageClient {
            val storage=mock(AttachmentStorageClient::class.java)
            doAnswer { objects[it.getArgument<String>(0)]=it.getArgument<AttachmentObjectPayload>(1).bytes; Unit }
                .`when`(storage).upload(anyString(),any(AttachmentObjectPayload::class.java) ?: AttachmentObjectPayload(ByteArray(0),""))
            `when`(storage.read(anyString())).thenAnswer { AttachmentObjectResult(objects.getValue(it.getArgument<String>(0))) }
            doAnswer { objects.remove(it.getArgument<String>(0)); Unit }.`when`(storage).delete(anyString())
            return storage
        }
    }

    private val png:ByteArray=ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2,2,BufferedImage.TYPE_INT_RGB),"png",it) }.toByteArray()

    @Test fun `only the world owner attaches files to a saved card and a removed card or deleted world hides them`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Doubles::class.java,ContentTestConfig::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val objects=ctx.getBean(Doubles::class.java).objects
                val owner=UUID.randomUUID();val other=UUID.randomUUID();val operator=UUID.randomUUID()
                for(id in listOf(owner,other)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                `when`(core.verify("Bearer $operator")).thenReturn(VerifiedMemberResponse(operator,true))
                val host="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}"
                val studios="/api/v1/world-studios"
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
                fun header(response:HttpResponse<ByteArray>,name:String)=response.headers().firstValue(name).orElse("")
                /** 파트 이름이 file인 multipart다. 형식은 파일명 확장자와 실제 바이트로 판단한다. */
                fun upload(path:String,filename:String,bytes:ByteArray,type:String,actor:UUID?=owner,method:String="POST",csrf:Boolean=true):HttpResponse<ByteArray> {
                    val boundary="card-attachment-${UUID.randomUUID()}"
                    val body="--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$filename\"\r\nContent-Type: $type\r\n\r\n".toByteArray()+
                        bytes+"\r\n--$boundary--\r\n".toByteArray()
                    return call(path,actor,method,body,"multipart/form-data; boundary=$boundary",csrf)
                }

                val create=CreateWorldRequest("카드 첨부 세계관","설명");val world=create.id
                assertEquals(200,send(studios,"POST",create).statusCode())
                var revision=0L
                fun card(title:String)=CardPayload(UUID.randomUUID(),title,"$title 원문","character","basic")
                fun saveDraft(vararg cards:CardPayload,key:String,replace:Boolean=false):HttpResponse<ByteArray> {
                    val response=send("$studios/$world/draft","PUT",EditWorldDraftRequest(revision,create.name,"설명",cards.toList(),emptyList(),key,replace))
                    if(response.statusCode()==200)revision=json(response).path("draftRevision").asLong()
                    return response
                }
                val kept=card("남는 인물");val gone=card("지울 인물");val unsaved=card("저장 전 인물")
                assertEquals(200,saveDraft(kept,gone,key="cards").statusCode())
                fun base(card:UUID)="$studios/$world/cards/$card/attachments"
                val path=base(kept.id)

                // 인증·CSRF·소유자·카드 확인: 거절된 요청은 객체 저장소에 아무것도 남기지 않는다.
                assertEquals(401,call(path,actor=null).statusCode())
                assertEquals(401,upload(path,"note.txt","참고".toByteArray(),"text/plain",actor=null).statusCode())
                assertEquals(403,upload(path,"note.txt","참고".toByteArray(),"text/plain",csrf=false).statusCode())
                assertEquals(404,call(path,actor=other).statusCode())
                assertEquals(404,upload(path,"note.txt","참고".toByteArray(),"text/plain",actor=other).statusCode())
                assertEquals(404,call(base(unsaved.id)).statusCode())              // 서버에 저장하지 않은 카드
                assertEquals(404,upload(base(unsaved.id),"note.txt","참고".toByteArray(),"text/plain").statusCode())
                assertEquals(404,call("$studios/$world/cards/not-a-uuid/attachments").statusCode())
                assertEquals(404,call("$studios/${UUID.randomUUID()}/cards/${kept.id}/attachments").statusCode())  // 다른 세계관 ID
                assertEquals(422,upload(path,"run.exe","MZ".toByteArray(),"application/octet-stream").statusCode())
                assertEquals(0,objects.size)

                // 소유자는 참고 파일과 설정 이미지를 올린다. 행은 카드만 가리키고 객체는 setting-attachments/<id> 키에 저장된다.
                val note=upload(path,"note.txt","참고 메모".toByteArray(),"text/plain");assertEquals(201,note.statusCode())
                assertEquals("FILE",json(note).path("kind").asString())
                val noteId=json(note).path("id").asString()
                assertEquals("$path/$noteId/content",json(note).path("url").asString())
                val image=upload(path,"map.png",png,"image/png");assertEquals(201,image.statusCode())
                assertEquals("IMAGE",json(image).path("kind").asString())
                val imageId=json(image).path("id").asString()
                assertEquals(2,objects.size);assertTrue(objects.keys.all { it.startsWith("setting-attachments/") })
                val source=ctx.getBean("contentDataSource",DataSource::class.java)
                source.connection.use { c ->
                    c.createStatement().use { s ->
                        s.executeQuery("select setting_document_id, world_card_id from setting_attachment order by created_at").use { rows ->
                            var n=0
                            while(rows.next()) { n++;assertNull(rows.getString(1));assertEquals(kept.id.toString(),rows.getString(2)) }
                            assertEquals(2,n)
                        }
                        // 한 행은 설정 문서와 카드 중 정확히 하나만 가리킨다(DB CHECK).
                        for(targets in listOf("null, null","'a', 'b'")) {
                            val failure=assertThrows(java.sql.SQLException::class.java) {
                                s.execute("insert into setting_attachment(id, setting_document_id, world_card_id, object_key, filename, media_type, kind, byte_size, created_at) values ('${UUID.randomUUID()}', $targets, 'k${UUID.randomUUID()}', 'x.txt', 'text/plain', 'FILE', 1, now())")
                            }
                            assertEquals("23514",failure.sqlState)
                        }
                    }
                }

                // 목록·내려받기: 소유자는 같은 바이트를 캐시 없이 받는다. 다른 카드에는 보이지 않는다.
                assertEquals(setOf(noteId,imageId),json(call(path)).path("attachments").values().map { it.path("id").asString() }.toSet())
                assertEquals(0,json(call(base(gone.id))).path("attachments").size())
                val downloaded=call("$path/$imageId/content")
                assertEquals(200,downloaded.statusCode());assertArrayEquals(png,downloaded.body());assertEquals("image/png",header(downloaded,"Content-Type"))
                assertEquals("private, no-store",header(downloaded,"Cache-Control"));assertEquals("nosniff",header(downloaded,"X-Content-Type-Options"))
                assertTrue(header(downloaded,"Content-Disposition").startsWith("attachment"))
                assertEquals(404,call("$path/$imageId/content",actor=other).statusCode())
                assertEquals(404,call("${base(gone.id)}/$imageId/content").statusCode())          // 다른 카드의 첨부 ID

                // 운영자는 열람만 한다: GET은 소유자와 같고 쓰기는 소유자만이다(사용자 결정 2026-11-23).
                assertEquals(200,call(path,actor=operator).statusCode())
                assertArrayEquals(png,call("$path/$imageId/content",actor=operator).body())
                assertEquals(404,upload(path,"op.txt","운영".toByteArray(),"text/plain",actor=operator).statusCode())
                assertEquals(404,call("$path/$noteId",actor=operator,method="DELETE").statusCode())

                // 이름 변경은 확장자를 지키고, 교체는 같은 ID에 새 객체를 올리며, 삭제는 행과 객체를 지운다.
                assertEquals(200,send("$path/$noteId","PATCH",mapOf("filename" to "참고 최종.txt")).statusCode())
                assertEquals(422,send("$path/$noteId","PATCH",mapOf("filename" to "참고 최종.md")).statusCode())
                val replaced=upload("$path/$noteId","note2.md","# 새 메모".toByteArray(),"text/markdown",method="PUT")
                assertEquals(200,replaced.statusCode());assertEquals(noteId,json(replaced).path("id").asString())
                assertEquals(404,upload("$path/${UUID.randomUUID()}","note2.md","# 새 메모".toByteArray(),"text/markdown",method="PUT").statusCode())
                assertEquals(204,call("$path/$noteId",method="DELETE").statusCode())
                assertEquals(404,call("$path/$noteId").statusCode())
                assertEquals(1,objects.size)

                // 지운 카드(초안에서 빠진 카드)는 소유자에게도 없는 것이다. 첨부 행과 객체는 그대로 남지만 읽을 수 없다.
                assertEquals(201,upload(base(gone.id),"gone.txt","곧 지움".toByteArray(),"text/plain").statusCode())
                assertEquals(200,saveDraft(kept,key="remove",replace=true).statusCode())
                assertEquals(404,call(base(gone.id)).statusCode())
                assertEquals(404,upload(base(gone.id),"again.txt","다시".toByteArray(),"text/plain").statusCode())
                assertEquals(200,call(path).statusCode())

                // 세계관을 지우면(소프트 삭제) 남은 카드의 첨부도 소유자에게 보이지 않는다.
                assertEquals(204,call("$studios/$world",method="DELETE").statusCode())
                assertEquals(404,call(path).statusCode())
                assertEquals(404,call("$path/$imageId/content").statusCode())
            }
        }
    }
}
