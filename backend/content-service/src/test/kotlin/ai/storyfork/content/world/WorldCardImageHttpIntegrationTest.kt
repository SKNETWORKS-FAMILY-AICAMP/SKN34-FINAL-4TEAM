package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
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

/**
 * Hosted CI only: 설정 카드 대표 이미지(#401)를 실제 Content HTTP/CSRF/보안·PostgreSQL(V8)·Neo4j로 확인한다.
 * Core 회원 검증·닉네임과 객체 저장소(MinIO)는 대역이다.
 */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldCardImageHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Doubles {
        /** 객체 저장소 대역이 들고 있는 객체(키 → 바이트). */
        val objects=ConcurrentHashMap<String,ByteArray>()
        @Bean @Primary fun cardImageTestCoreAuthClient():CoreAuthClient=mock(CoreAuthClient::class.java)
        @Bean @Primary fun cardImageTestCoreNicknames():CoreNicknameService=mock(CoreNicknameService::class.java)
        @Bean @Primary fun cardImageTestStorage():AttachmentStorageClient {
            val storage=mock(AttachmentStorageClient::class.java)
            doAnswer { objects[it.getArgument<String>(0)]=it.getArgument<AttachmentObjectPayload>(1).bytes; Unit }
                .`when`(storage).upload(anyString(),any(AttachmentObjectPayload::class.java) ?: AttachmentObjectPayload(ByteArray(0),""))
            `when`(storage.read(anyString())).thenAnswer { AttachmentObjectResult(objects.getValue(it.getArgument<String>(0))) }
            doAnswer { objects.remove(it.getArgument<String>(0)); Unit }.`when`(storage).delete(anyString())
            return storage
        }
    }

    private fun image(format:String):ByteArray=ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2,2,BufferedImage.TYPE_INT_RGB),format,it) }.toByteArray()

    @Test fun `owner uploads card images, a card points at one only through the draft, and readers see it only through the confirmed version`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            SpringApplicationBuilder(ContentServiceApplication::class.java,Doubles::class.java,ContentTestConfig::class.java).run(
                "--server.port=0",
                "--DATABASE_URL=${db.url}","--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32").use { ctx ->
                val client=HttpClient.newHttpClient();val mapper=ctx.getBean(JsonMapper::class.java)
                val core=ctx.getBean(CoreAuthClient::class.java);val objects=ctx.getBean(Doubles::class.java).objects
                val owner=UUID.randomUUID();val other=UUID.randomUUID()
                for(id in listOf(owner,other)) `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
                // 공개 상세는 작가 표시명을 Core에서 읽는다.
                `when`(ctx.getBean(CoreNicknameService::class.java).nicknames(listOf(owner.toString()))).thenReturn(mapOf(owner.toString() to "카드 작가"))
                val works=ctx.getBean(WorkService::class.java);val driver=ctx.getBean(ContentTestDriver::class.java)
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
                fun header(response:HttpResponse<ByteArray>,name:String)=response.headers().firstValue(name).orElse("")
                /** 파트 이름이 file인 multipart다. 서버는 보낸 형식(octet-stream)·파일명을 믿지 않고 바이트로 판단한다. */
                fun upload(world:UUID,bytes:ByteArray,actor:UUID?=owner,csrf:Boolean=true,part:String="file"):HttpResponse<ByteArray> {
                    val boundary="card-image-${UUID.randomUUID()}"
                    val body="--$boundary\r\nContent-Disposition: form-data; name=\"$part\"; filename=\"portrait.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n".toByteArray()+
                        bytes+"\r\n--$boundary--\r\n".toByteArray()
                    return call("$studios/$world/card-images",actor,"POST",body,"multipart/form-data; boundary=$boundary",csrf)
                }
                fun work(actor:UUID,title:String):String=works.create(actor.toString(),CreateWorkRequest(title,"소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
                fun publishFirst(id:String) {
                    val draft=driver.edit(id,owner.toString(),DraftRequest("1화","본문",0))
                    driver.publish(id,owner.toString(),PublishRequest(draft.revision,true,true,true,driver.history(id,owner.toString()).versions.last().id))
                }
                fun publishNext(id:String,number:Int) {
                    val saved=driver.writeEpisode(id,owner.toString(),number,DraftRequest("${number}화","본문",driver.writing(id,owner.toString(),number).draft.revision),true)
                    driver.publishEpisode(id,owner.toString(),number,PublishRequest(saved.draft.revision,true,versionId=saved.versions.last().id))
                }

                val create=CreateWorldRequest("카드 이미지 세계관","설명");val world=create.id
                assertEquals(200,send(studios,"POST",create).statusCode())
                val sibling=CreateWorldRequest("다른 세계관","");assertEquals(200,send(studios,"POST",sibling).statusCode())
                val png=image("png");val jpeg=image("jpeg")

                // 인증·CSRF·소유자·값 검사: 거절된 업로드는 객체 저장소에 아무것도 남기지 않는다.
                assertEquals(401,upload(world,png,actor=null).statusCode())
                assertEquals(403,upload(world,png,csrf=false).statusCode())
                assertEquals(404,upload(world,png,actor=other).statusCode())
                assertEquals(422,upload(world,"이미지가 아닌 글".toByteArray()).statusCode())
                assertEquals(422,upload(world,png,part="other").statusCode())
                val tooBig=upload(world,ByteArray(5*1024*1024+1))
                assertEquals(422,tooBig.statusCode());assertEquals("WORLD_INPUT_INVALID",json(tooBig).path("code").asString())
                assertTrue(json(tooBig).path("detail").isString)
                assertEquals(0,objects.size)

                // 올리면 201과 새 이미지 ID이고 객체는 world-card-images/<id> 키에 저장된다. 올릴 때마다 새 이미지다.
                val imgA=upload(world,png);assertEquals(201,imgA.statusCode())
                assertEquals("image/png",json(imgA).path("contentType").asString())
                val a=json(imgA).path("imageId").asString();assertEquals(setOf("world-card-images/$a"),objects.keys)
                val b=json(upload(world,jpeg)).path("imageId").asString();assertNotEquals(a,b);assertEquals(2,objects.size)
                val foreign=json(upload(sibling.id,png)).path("imageId").asString()

                // 소유자는 같은 바이트를 캐시 없이 읽는다. 비로그인·남·없는 ID·다른 세계관의 ID는 막힌다.
                val own=call("$studios/$world/card-images/$a")
                assertEquals(200,own.statusCode());assertArrayEquals(png,own.body());assertEquals("image/png",header(own,"Content-Type"))
                assertEquals("private, no-store",header(own,"Cache-Control"));assertEquals("nosniff",header(own,"X-Content-Type-Options"))
                assertEquals(401,call("$studios/$world/card-images/$a",actor=null).statusCode())
                assertEquals(404,call("$studios/$world/card-images/$a",actor=other).statusCode())
                assertEquals(404,call("$studios/$world/card-images/${UUID.randomUUID()}").statusCode())
                assertEquals(404,call("$studios/$world/card-images/$foreign").statusCode())
                assertEquals(400,call("$studios/$world/card-images/not-a-uuid").statusCode())

                // 초안 저장: 카드가 가리키는 이미지는 이 세계관이 올린 것이어야 한다. 아니면 422이고 이전 초안이 그대로다.
                var revision=0L
                fun card(title:String,visibility:String,reveal:Int,image:Any?)=CardPayload(UUID.randomUUID(),title,"$title 원문","character","basic",
                    semanticMetadata=mapOf<String,Any?>("revealFromEpisode" to reveal,"imageId" to image),visibility=visibility)
                fun saveDraft(vararg cards:CardPayload,key:String):HttpResponse<ByteArray> {
                    val response=send("$studios/$world/draft","PUT",EditWorldDraftRequest(revision,create.name,"설명",cards.toList(),emptyList(),key,false))
                    if(response.statusCode()==200)revision=json(response).path("draftRevision").asLong()
                    return response
                }
                val shown=card("공개 인물","public",1,a)
                val hidden=card("비공개 인물","private",2,b)
                for((index,bad) in listOf<Any>(foreign,UUID.randomUUID().toString(),"not-a-uuid",42).withIndex()) {
                    val refused=saveDraft(shown.copy(semanticMetadata=mapOf("revealFromEpisode" to 1,"imageId" to bad)),key="bad-${index}")
                    assertEquals(422,refused.statusCode());assertEquals("WORLD_INPUT_INVALID",json(refused).path("code").asString())
                }
                assertEquals(revision,json(call("$studios/$world")).path("draftRevision").asLong())
                assertEquals(0,json(call("$studios/$world")).path("cards").size())
                val saved=saveDraft(shown,hidden,key="with-images");assertEquals(200,saved.statusCode())
                assertEquals(a,json(saved).path("cards").values().first { it.path("id").asString()==shown.id.toString() }.path("semanticMetadata").path("imageId").asString())

                // 확정 버전이 없는 동안은 공개로 설정해도 비로그인에는 404다.
                val publicA="$publics/$world/card-images/$a"
                assertEquals(404,call(publicA,actor=null).statusCode())
                assertEquals(200,send("$studios/$world/publication","PUT",PublicationRequest("public","fantasy")).statusCode())
                assertEquals(404,call(publicA,actor=null).statusCode())

                // 확정하면 공개 카드가 가리키는 이미지만 비로그인으로 읽힌다. 비공개 카드·다른 세계관·없는 ID·UUID가 아닌 값은 아니다.
                assertEquals(200,send("$studios/$world/revisions","POST",SaveWorldRequest(revision,"images-save-1")).statusCode())
                revision=json(call("$studios/$world")).path("draftRevision").asLong()
                val seen=call(publicA,actor=null)
                assertEquals(200,seen.statusCode());assertArrayEquals(png,seen.body());assertEquals("image/png",header(seen,"Content-Type"))
                assertEquals("private, no-store",header(seen,"Cache-Control"));assertEquals("nosniff",header(seen,"X-Content-Type-Options"))
                for(denied in listOf(b,foreign,UUID.randomUUID().toString())) assertEquals(404,call("$publics/$world/card-images/$denied",actor=null).statusCode(),denied)
                assertEquals(400,call("$publics/$world/card-images/not-a-uuid",actor=null).statusCode())
                val detail=call("$publics/$world",actor=null)
                assertEquals(listOf(a),json(detail).path("cards").values().map { it.path("imageId").asString() })

                // 교체는 새 이미지를 올려 카드가 새 ID를 가리키는 것이다: 확정하기 전에는 공개 화면이 그대로이고 옛 이미지도 그대로 보인다.
                val c=json(upload(world,jpeg)).path("imageId").asString()
                assertEquals(200,saveDraft(shown.copy(semanticMetadata=mapOf("revealFromEpisode" to 1,"imageId" to c)),key="swap").statusCode())
                assertEquals(a,json(call("$publics/$world",actor=null)).path("cards").get(0).path("imageId").asString())
                assertEquals(200,call(publicA,actor=null).statusCode());assertEquals(404,call("$publics/$world/card-images/$c",actor=null).statusCode())
                assertEquals(200,send("$studios/$world/revisions","POST",SaveWorldRequest(revision,"images-save-2")).statusCode())
                assertEquals(c,json(call("$publics/$world",actor=null)).path("cards").get(0).path("imageId").asString())
                assertEquals(200,call("$publics/$world/card-images/$c",actor=null).statusCode())
                // 옛 이미지는 지워지지 않아 소유자는 읽지만, 어떤 확정 버전 카드도 가리키지 않으니 공개로는 404다.
                assertEquals(404,call(publicA,actor=null).statusCode());assertEquals(200,call("$studios/$world/card-images/$a").statusCode())

                // 독자 설정 위키: 발행된 회차까지 독자 공개 회차가 열린 카드의 이미지만 읽힌다(카드·세계관의 공개 범위와 별개).
                val mine=work(owner,"이미지 소설")
                assertEquals(200,send("/api/v1/works/$mine/world-studio","PUT",mapOf("worldId" to world)).statusCode())
                publishFirst(mine)
                val wiki="/api/v1/public/works/$mine/world-cards";val readerImage="/api/v1/public/works/$mine/world-card-images"
                val one=json(call(wiki,actor=null))
                assertEquals(listOf(shown.id.toString()),one.path("cards").values().map { it.path("id").asString() })
                assertEquals(c,one.path("cards").get(0).path("imageId").asString())
                val read=call("$readerImage/$c",actor=null)
                assertEquals(200,read.statusCode());assertArrayEquals(jpeg,read.body());assertEquals("private, no-store",header(read,"Cache-Control"))
                assertEquals(404,call("$readerImage/$b",actor=null).statusCode())   // 2화부터 공개되는 카드
                assertEquals(404,call("$readerImage/$a",actor=null).statusCode())   // 확정 버전 카드가 가리키지 않는 옛 이미지
                publishNext(mine,2)
                assertEquals(setOf(c,b),json(call(wiki,actor=null)).path("cards").values().map { it.path("imageId").asString() }.toSet())
                assertEquals(200,call("$readerImage/$b",actor=null).statusCode())                       // 비공개 카드여도 독자 공개 회차가 열렸다
                assertEquals(404,call("$readerImage/$b?upto=1",actor=null).statusCode())             // 회차 화면이 1화 기준이면 아직이다
                assertEquals(200,call("$readerImage/$b?upto=2",actor=null).statusCode())
                for(bad in listOf("0","-1","x")) assertEquals(422,call("$readerImage/$b?upto=$bad",actor=null).statusCode())
                assertEquals(404,call("/api/v1/public/works/${UUID.randomUUID()}/world-card-images/$b",actor=null).statusCode())
                assertEquals(400,call("$readerImage/not-a-uuid",actor=null).statusCode())
                assertEquals(404,call("$readerImage/$foreign",actor=null).statusCode())
                // 연결을 풀면 독자에게 아무 이미지도 나가지 않는다.
                assertEquals(200,send("/api/v1/works/$mine/world-studio","PUT",mapOf("worldId" to null)).statusCode())
                assertEquals(404,call("$readerImage/$c",actor=null).statusCode())
            }
        }
    }
}
