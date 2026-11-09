package ai.storyfork.content.attachment

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.work.entity.MemberEntity
import ai.storyfork.content.work.repository.MemberRepository
import ai.storyfork.content.fixture.model.*
import ai.storyfork.content.fixture.*
import ai.storyfork.content.fixture.model.Setting
import ai.storyfork.content.fixture.ContentTestDriver as ContentService
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.Executors
import javax.imageio.ImageIO
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

/** 실제 HTTP·PostgreSQL·S3 호환 저장소를 사용하는 선택적 통합 검증. */
@org.springframework.context.annotation.Import(ai.storyfork.content.fixture.ContentTestConfig::class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "spring.datasource.url=\${TEST_ATTACHMENT_DATABASE_URL}",
    "spring.datasource.username=content_test", "spring.datasource.password=",
    "DATABASE_URL=\${TEST_ATTACHMENT_DATABASE_URL}", "DATABASE_USER=content_test", "DATABASE_PASSWORD=",
    "spring.mail.host=127.0.0.1", "spring.mail.port=1",
    "app.auth.public-origin=http://localhost:5173", "app.auth.mail-from=test@example.invalid",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "app.setting-attachments.bucket=issue87-test", "app.setting-attachments.region=us-east-1",
    "app.setting-attachments.endpoint=\${TEST_ATTACHMENT_S3_ENDPOINT:http://127.0.0.1:19087}",
])
@EnabledIfEnvironmentVariable(named = "TEST_ATTACHMENT_DATABASE_URL", matches = ".+")
class SettingAttachmentHttpTest {
    // 작가명·작성자명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 빈 결과를 돌려주는 대역이다.
    @org.springframework.test.context.bean.override.mockito.MockitoBean lateinit var nicknames: ai.storyfork.content.auth.service.CoreNicknameService
    @LocalServerPort var port = 0
    @Autowired lateinit var members: MemberRepository
    @org.springframework.test.context.bean.override.mockito.MockitoBean lateinit var core: CoreAuthClient
    @Autowired @org.springframework.beans.factory.annotation.Qualifier("contentTransactions") lateinit var authTransactions: org.springframework.transaction.support.TransactionTemplate
    @Autowired @org.springframework.beans.factory.annotation.Qualifier("attachmentTransactions")
    lateinit var attachmentTransactions: org.springframework.transaction.support.TransactionTemplate
    @Autowired lateinit var content: ContentService
    @Autowired lateinit var json: ObjectMapper
    @Autowired lateinit var s3: software.amazon.awssdk.services.s3.S3Client
    @Autowired @org.springframework.beans.factory.annotation.Qualifier("contentDataSource") lateinit var source: javax.sql.DataSource
    private val jdbc get() = org.springframework.jdbc.core.JdbcTemplate(source)
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    lateinit var storage: ai.storyfork.content.attachment.client.AttachmentStorageClient
    @org.junit.jupiter.api.BeforeEach fun privateBucket() {
        try { s3.headBucket { it.bucket("issue87-test") } }
        catch (e: software.amazon.awssdk.services.s3.model.NoSuchBucketException) { s3.createBucket { it.bucket("issue87-test") } }
        catch (e: software.amazon.awssdk.services.s3.model.S3Exception) {
            if (e.statusCode() != 404) throw e
            s3.createBucket { it.bucket("issue87-test") }
        }
    }
    private val cookies = CookieManager(null, CookiePolicy.ACCEPT_ALL)
    private val http = HttpClient.newBuilder().cookieHandler(cookies).build()
    private val concurrentHttp = HttpClient.newHttpClient()
    private val png get() = image("png", 2)
    private fun image(format: String, width: Int) = ByteArrayOutputStream().also {
        ImageIO.write(BufferedImage(width, 2, BufferedImage.TYPE_INT_RGB), format, it)
    }.toByteArray()
    private data class Actor(val id: String, val token: String)
    private fun request(path: String) = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
    private fun send(builder: HttpRequest.Builder): HttpResponse<ByteArray> = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray())
    private fun node(response: HttpResponse<ByteArray>): JsonNode = json.readTree(response.body())
    private fun csrf(): String {
        cookies.cookieStore.add(URI.create("http://127.0.0.1:$port"),java.net.HttpCookie("XSRF-TOKEN",CsrfFixture.raw).apply { path="/";version=0 })
        return CsrfFixture.token()
    }
    private fun actor(): Actor {
        val id=UUID.randomUUID()
        org.mockito.Mockito.`when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
        return Actor(id.toString(),id.toString())
    }
    private fun fixture(actor: Actor): String {
        val work = content.create(actor.id, CreateWorkRequest("첨부 검증"))
        val saved = content.saveSetting(work.id, "new", actor.id, SettingRequest(0, Setting(name="지역", content="비공개 설정"), content.world(work.id, actor.id).sourceToken))
        return "/api/v1/works/${work.id}/settings/${saved.draft!!.id}/attachments"
    }
    private fun get(path: String, actor: Actor?) = send(request(path).apply { actor?.let { header("Authorization", "Bearer ${it.token}") } })
    private fun upload(path: String, actor: Actor?, bytes: ByteArray = png, filename: String = "map.png", type: String = "image/png", method: String = "POST", token: String = csrf(), origin: String? = null, cookie: String? = null): HttpResponse<ByteArray> {
        val boundary = "issue87boundary"
        val prefix = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$filename\"\r\nContent-Type: $type\r\n\r\n".toByteArray()
        val builder = request(path).header("Content-Type", "multipart/form-data; boundary=$boundary").apply {
            actor?.let { header("Authorization", "Bearer ${it.token}") }
            if (token.isNotEmpty()) header("X-CSRF-TOKEN", token)
            origin?.let { header("Origin", it) }
            cookie?.let { header("Cookie", it) }
        }.method(method, HttpRequest.BodyPublishers.ofByteArray(prefix + bytes + "\r\n--$boundary--\r\n".toByteArray()))
        // JWT authentication rotates the response CSRF cookie; concurrent requests keep their valid request snapshot.
        return (if (cookie == null) http else concurrentHttp).send(builder.build(), HttpResponse.BodyHandlers.ofByteArray())
    }
    private fun delete(path: String, actor: Actor) = send(request(path).header("Authorization", "Bearer ${actor.token}").header("X-CSRF-TOKEN", csrf()).DELETE())

    @Test fun `content JPA transactions stay separate from attachment transactions`() {
        val authManager = assertInstanceOf(org.springframework.orm.jpa.JpaTransactionManager::class.java, authTransactions.transactionManager)
        assertNotSame(attachmentTransactions.transactionManager, authManager)
        assertEquals(setOf("ai.storyfork.content.work.entity","ai.storyfork.content.episode.entity","ai.storyfork.content.episode_version.entity","ai.storyfork.content.publication.entity","ai.storyfork.content.world.entity","ai.storyfork.content.fork.entity","ai.storyfork.content.proposal.entity","ai.storyfork.content.plan.entity","ai.storyfork.content.comment.entity","ai.storyfork.content.reading.entity"), requireNotNull(authManager.entityManagerFactory)
            .metamodel.entities.map { it.javaType.packageName }.toSet())
        val id = UUID.randomUUID().toString()
        authTransactions.executeWithoutResult { status ->
            members.saveAndFlush(MemberEntity(id))
            status.setRollbackOnly()
        }
        assertFalse(members.existsById(id))
        val owner = actor()
        val base = fixture(owner)
        val listed = get(base, owner)
        assertEquals(200, listed.statusCode())
        assertTrue(node(listed).path("attachments").isEmpty)
        assertEquals(401, get(base, null).statusCode())
        assertEquals(404, get(base, actor()).statusCode())
    }

    @Test fun `work cover persists replaces deletes and follows existing publication access`() {
        val owner = actor(); val other = actor()
        val work = content.create(owner.id, CreateWorkRequest("표지 검증"))
        val path = "/api/v1/works/${work.id}/cover"
        assertEquals(401, get(path, null).statusCode())
        assertEquals(404, upload(path, other, method="PUT").statusCode())
        // Ownership is checked before the file, so a stranger cannot probe work IDs with an invalid file.
        assertEquals(404, upload(path, other, "text".toByteArray(), "note.txt", "text/plain", "PUT").statusCode())
        val created = upload(path, owner, method="PUT")
        assertEquals(200, created.statusCode(), String(created.body()))
        val url = node(created).path("url").asText()
        assertEquals("$path/content", url)
        assertArrayEquals(png, get(url, owner).body())
        assertEquals(404, get("/api/v1/public/works/${work.id}/cover/content", null).statusCode())
        assertEquals(422, upload(path, owner, "text".toByteArray(), "note.txt", "text/plain", "PUT").statusCode())
        assertArrayEquals(png, get(url, owner).body())
        val replacement = image("jpg", 3)
        assertEquals(200, upload(path, owner, replacement, "new.jpg", "image/jpeg", "PUT").statusCode())
        assertArrayEquals(replacement, get(url, owner).body())
        assertEquals(204, delete(path, owner).statusCode())
        assertEquals(404, get(url, owner).statusCode())
    }

    @Test fun `manuscript image references survive versions and only published references are publicly readable`() {
        val owner = actor(); val other = actor()
        val work = content.create(owner.id, CreateWorkRequest("본문 검증"))
        content.createEpisode(work.id, owner.id, CreateWorkRequest("1화"))
        val base = "/api/v1/works/${work.id}/episodes/1/images"
        assertEquals(401, upload(base, null).statusCode())
        assertEquals(404, upload(base, other).statusCode())
        assertEquals(404, upload(base, other, "text".toByteArray(), "note.txt", "text/plain").statusCode())
        val created = upload(base, owner)
        assertEquals(201, created.statusCode(), String(created.body()))
        val id = node(created).path("id").asText()
        val body = "앞 문단\n\n[[image:$id]]\n\n뒤 문단"
        val saved = content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", body, 0), true)
        assertEquals(body, content.writing(work.id, owner.id, 1).draft.body)
        val publicPath = "/api/v1/public/works/${work.id}/episodes/1/images/$id/content"
        assertEquals(404, get(publicPath, null).statusCode())
        content.publishEpisode(work.id, owner.id, 1, PublishRequest(saved.draft.revision, true, versionId=saved.versions.last().id))
        val published = get(publicPath, null)
        assertEquals(200, published.statusCode()); assertArrayEquals(png, published.body())
        assertEquals("nosniff", published.headers().firstValue("X-Content-Type-Options").orElse(""))
        val unpublished = upload(base, owner)
        assertEquals(404, get(publicPath.replace(id, node(unpublished).path("id").asText()), null).statusCode())
        assertEquals(404, get(node(created).path("url").asText(), other).statusCode())
        assertEquals(404, get(publicPath.replace("/episodes/1/", "/episodes/2/"), null).statusCode())
    }

    @Test fun `inherited manuscript images use only the frozen basis body and reject unpublished references`() {
        val owner = actor(); val reader = actor(); val stranger = actor()
        val work = content.create(owner.id, CreateWorkRequest("이미지 Fork 검증"))
        content.createEpisode(work.id, owner.id, CreateWorkRequest("1화"))
        val base = "/api/v1/works/${work.id}/episodes/1/images"
        val created = upload(base, owner); val id = node(created).path("id").asText()
        val hidden = node(upload(base, owner)).path("id").asText()
        val saved = content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", "기준[[image:$id]]", 0), true)
        content.publishEpisode(work.id, owner.id, 1, PublishRequest(saved.draft.revision, true, versionId=saved.versions.last().id))
        content.policy(work.id, owner.id, PolicyRequest(content.read(work.id, owner.id).draft!!.revision, true, true))
        val fork = content.fork(work.id, reader.id, ForkRequest(1, "이미지 기준 분기"))
        val forkBase = base.replace(work.id, fork.id)
        assertArrayEquals(png, get("$forkBase/$id/content", reader).body())
        assertEquals(404, get("$forkBase/$hidden/content", reader).statusCode())
        assertEquals(404, get("$forkBase/$id/content", stranger).statusCode())
        assertEquals(403, upload(forkBase, reader).statusCode())
        // 원작 재발행 뒤에도 Fork의 고정 원고에 포함된 bytes만 보존한다.
        val changed = content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", "이미지 없는 개정", content.writing(work.id, owner.id, 1).draft.revision), true)
        content.publishEpisode(work.id, owner.id, 1, PublishRequest(changed.draft.revision, true, versionId=changed.versions.last().id))
        assertEquals(404, get("/api/v1/public/works/${work.id}/episodes/1/images/$id/content", null).statusCode())
        assertEquals(200, get("$forkBase/$id/content", reader).statusCode())
        assertEquals("기준[[image:$id]]", content.writing(fork.id, reader.id, 1).draft.body)
    }

    @Test fun `content images enforce safe validation scoped references and immutable saved versions`() {
        val owner = actor(); val work = content.create(owner.id, CreateWorkRequest("범위 검증"))
        content.createEpisode(work.id, owner.id, CreateWorkRequest("1화"))
        content.createEpisode(work.id, owner.id, CreateWorkRequest("2화"))
        val base = "/api/v1/works/${work.id}/episodes/1/images"
        val created = upload(base, owner); assertEquals(201, created.statusCode())
        val id = node(created).path("id").asText(); val body = "앞[[image:$id]]뒤"
        assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) { content.writeEpisode(work.id, owner.id, 2, DraftRequest("2화", body, 0), true) }
        assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) { content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", "data:image/png;base64,eA==", 0), true) }
        assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) { content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", "[[image:${UUID.randomUUID()}]]", 0), true) }
        val saved = content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", body, 0), true)
        content.writeEpisode(work.id, owner.id, 1, DraftRequest("1화", "현재 텍스트", saved.draft.revision), true)
        val restored = content.restoreEpisode(work.id, owner.id, 1, RevertRequest(2, saved.versions.last().id))
        assertEquals(body, restored.draft.body)
        assertArrayEquals(png, get(node(created).path("url").asText(), owner).body())
        assertEquals(403, upload(base, owner, token="").statusCode())
        assertEquals(422, upload(base, owner, ByteArray(0)).statusCode())
        assertEquals(422, upload(base, owner, "<svg/>".toByteArray(), "bad.svg", "image/svg+xml").statusCode())
        assertEquals(413, upload(base, owner, ByteArray(10485761)).statusCode())
        repeat(9) { assertEquals(201, upload(base, owner).statusCode()) }
        assertEquals(409, upload(base, owner).statusCode())
        val cover = "/api/v1/works/${work.id}/cover"
        assertEquals(200, upload(cover, owner, method="PUT").statusCode())
        content.publishEpisode(work.id, owner.id, 1, PublishRequest(restored.draft.revision, true, versionId=restored.versions.last().id))
        assertEquals(200, get("/api/v1/public/works/${work.id}/cover/content", null).statusCode())
    }

    @Test fun `cover storage and database failures preserve previous bytes and metadata`() {
        val owner = actor(); val work = content.create(owner.id, CreateWorkRequest("실패 보존"))
        val path = "/api/v1/works/${work.id}/cover"
        assertEquals(200, upload(path, owner, method="PUT").statusCode())
        jdbc.execute("ALTER TABLE content_image ADD CONSTRAINT issue92_reject_filename CHECK(filename <> 'reject-db.png')")
        try {
            assertEquals(503, upload(path, owner, image("png", 3), "reject-db.png", "image/png", "PUT").statusCode())
            assertEquals("map.png", node(get(path, owner)).path("filename").asText())
            assertArrayEquals(png, get("$path/content", owner).body())
        } finally { jdbc.execute("ALTER TABLE content_image DROP CONSTRAINT issue92_reject_filename") }
        org.mockito.Mockito.doThrow(ai.storyfork.content.attachment.domain.AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "저장소 요청 실패"))
            .`when`(storage).upload(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload::class.java)
                    ?: ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload(ByteArray(0), ""))
        assertEquals(503, upload(path, owner, image("png", 3), method="PUT").statusCode())
        assertArrayEquals(png, get("$path/content", owner).body())
    }

    @Test fun `image upload metadata list read replace delete uses private storage`() {
        val owner = actor(); val base = fixture(owner)
        val created = upload(base, owner)
        assertEquals(201, created.statusCode(), String(created.body()))
        val metadata = node(created); val id = metadata.path("id").asText(); val url = metadata.path("url").asText()
        assertEquals("IMAGE", metadata.path("kind").asText())
        assertEquals("image/png", metadata.path("mediaType").asText())
        assertEquals("$base/$id/content", url)
        assertFalse(String(created.body()).contains("19087"))
        assertEquals(id, node(get(base, owner)).path("attachments").single().path("id").asText())
        assertEquals(id, node(get("$base/$id", owner)).path("id").asText())
        val downloaded = get(url, owner)
        assertEquals(200, downloaded.statusCode()); assertArrayEquals(png, downloaded.body())
        assertEquals("nosniff", downloaded.headers().firstValue("X-Content-Type-Options").orElse(""))
        assertTrue(downloaded.headers().firstValue("Cache-Control").orElse("").contains("no-store"))
        val replacement = image("jpg", 3)
        val replaced = upload("$base/$id", owner, replacement, "new.jpg", "image/jpeg", "PUT")
        assertEquals(200, replaced.statusCode(), String(replaced.body()))
        assertEquals(id, node(replaced).path("id").asText()); assertArrayEquals(replacement, get(url, owner).body())
        assertEquals(204, delete("$base/$id", owner).statusCode())
        assertEquals(404, get(url, owner).statusCode()); assertTrue(node(get(base, owner)).path("attachments").isEmpty)
    }

    @Test fun `general files download only as safe attachments and have full CRUD`() {
        val owner = actor(); val base = fixture(owner)
        for ((filename, type, bytes) in listOf(
            Triple("메모.txt", "text/plain", "일반 메모".toByteArray()),
            Triple("notes.md", "text/markdown", "# Notes".toByteArray()),
            Triple("table.csv", "text/csv", "name,value\na,1".toByteArray()),
            Triple("document.pdf", "application/pdf", "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n".toByteArray()),
        )) {
            val created = upload(base, owner, bytes, filename, type)
            assertEquals(201, created.statusCode(), String(created.body()))
            assertEquals("FILE", node(created).path("kind").asText())
            val path = "$base/${node(created).path("id").asText()}"
            val download = get("$path/content", owner)
            assertEquals(200, download.statusCode()); assertArrayEquals(bytes, download.body())
            val disposition = download.headers().firstValue("Content-Disposition").orElse("")
            assertTrue(disposition.startsWith("attachment;")); assertFalse(disposition.contains("\r")); assertFalse(disposition.contains("\n"))
            assertEquals("nosniff", download.headers().firstValue("X-Content-Type-Options").orElse(""))
            val replaced = upload(path, owner, "새 본문".toByteArray(), "replaced.txt", "text/plain", "PUT")
            assertEquals(200, replaced.statusCode()); assertArrayEquals("새 본문".toByteArray(), get("$path/content", owner).body())
            assertEquals(204, delete(path, owner).statusCode()); assertEquals(404, get("$path/content", owner).statusCode())
        }
    }

    @Test fun `JWT ownership missing resources and csrf are enforced on every operation`() {
        val owner = actor(); val other = actor(); val base = fixture(owner)
        val created = upload(base, owner); assertEquals(201, created.statusCode())
        val path = "$base/${node(created).path("id").asText()}"
        assertEquals(401, get(path, null).statusCode()); assertEquals(401, upload(base, null).statusCode())
        assertEquals(403, upload(base, owner, token="").statusCode())
        assertEquals(403, upload(base, owner, origin="https://evil.example").statusCode())
        for (url in listOf(base, path, "$path/content")) assertEquals(404, get(url, other).statusCode())
        assertEquals(404, upload(base, other).statusCode()); assertEquals(404, upload(path, other, method="PUT").statusCode())
        assertEquals(404, upload(base, other, "text".toByteArray(), "note.txt", "text/plain").statusCode()); assertEquals(404, upload(path, other, "text".toByteArray(), "note.txt", "text/plain", "PUT").statusCode())
        assertEquals(404, delete(path, other).statusCode())
        assertEquals(404, get("$base/missing", owner).statusCode())
        assertEquals(404, upload(base.replace("/settings/", "/settings/missing-"), owner).statusCode())
        assertArrayEquals(png, get("$path/content", owner).body())
    }

    @Test fun `ten image ceiling holds under concurrent uploads and does not apply to files`() {
        val owner = actor(); val base = fixture(owner); val token = csrf()
        val cookie = cookies.cookieStore.cookies.filter { it.name == "XSRF-TOKEN" }.joinToString("; ") { "${it.name}=${it.value}" }
        val pool = Executors.newFixedThreadPool(6)
        val results = try { (1..12).map { pool.submit<HttpResponse<ByteArray>> { upload(base, owner, token=token, cookie=cookie) } }.map { it.get() } } finally { pool.shutdownNow() }
        assertEquals(10, results.count { it.statusCode()==201 }, results.joinToString { "${it.statusCode()}:${String(it.body())}" })
        assertEquals(2, results.count { it.statusCode()==409 })
        val first = node(results.first { it.statusCode()==201 }).path("id").asText()
        assertEquals(200, upload("$base/$first", owner, method="PUT").statusCode())
        val file = upload(base, owner, "text".toByteArray(), "file.txt", "text/plain")
        assertEquals(201, file.statusCode())
        val filePath = "$base/${node(file).path("id").asText()}"
        assertEquals(409, upload(filePath, owner, method="PUT").statusCode())
        assertEquals(11, node(get(base, owner)).path("attachments").size())
        assertEquals(200, upload("$base/$first", owner, "text".toByteArray(), "converted.txt", "text/plain", "PUT").statusCode())
        assertEquals(200, upload(filePath, owner, method="PUT").statusCode())
        assertEquals(409, upload(base, owner).statusCode())
        assertEquals(204, delete(filePath, owner).statusCode()); assertEquals(201, upload(base, owner).statusCode())
    }

    @Test fun `ambiguous object deletion failure preserves old reference and readable bytes`() {
        val owner = actor(); val base = fixture(owner)
        val created = upload(base, owner); assertEquals(201, created.statusCode())
        val path = "$base/${node(created).path("id").asText()}"
        org.mockito.Mockito.doAnswer { invocation ->
            invocation.callRealMethod()
            throw ai.storyfork.content.attachment.domain.AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "저장소 요청 실패")
        }.`when`(storage).delete(org.mockito.ArgumentMatchers.anyString())
        val replaced = upload(path, owner, "new".toByteArray(), "new.txt", "text/plain", "PUT")
        assertEquals(503, replaced.statusCode()); assertEquals("map.png", node(get(path, owner)).path("filename").asText())
        val afterReplace = get("$path/content", owner)
        assertEquals(200, afterReplace.statusCode()); assertArrayEquals(png, afterReplace.body())
        assertEquals(503, delete(path, owner).statusCode())
        val afterDelete = get("$path/content", owner)
        assertEquals(200, afterDelete.statusCode()); assertArrayEquals(png, afterDelete.body())
    }

    @Test fun `failed upload or replacement never switches the current reference`() {
        val owner = actor(); val base = fixture(owner)
        val created = upload(base, owner); assertEquals(201, created.statusCode())
        val path = "$base/${node(created).path("id").asText()}"
        org.mockito.Mockito.doThrow(ai.storyfork.content.attachment.domain.AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "저장소 요청 실패"))
            .`when`(storage).upload(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload::class.java)
                    ?: ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload(ByteArray(0), ""))
        assertEquals(503, upload(base, owner).statusCode())
        assertEquals(503, upload(path, owner, "new".toByteArray(), "new.txt", "text/plain", "PUT").statusCode())
        assertEquals(1, node(get(base, owner)).path("attachments").size())
        assertEquals("map.png", node(get(path, owner)).path("filename").asText())
        assertArrayEquals(png, get("$path/content", owner).body())
    }

    @Test fun `failed compensation is explicit and requires operator recovery not false success`() {
        val owner = actor(); val base = fixture(owner)
        val bytes = "원래 문서".toByteArray()
        val created = upload(base, owner, bytes, "original.txt", "text/plain"); assertEquals(201, created.statusCode())
        val id = node(created).path("id").asText(); val path = "$base/$id"
        val key = jdbc.queryForObject("SELECT object_key FROM setting_attachment WHERE id=?", String::class.java, id)!!
        org.mockito.Mockito.doAnswer { invocation ->
            invocation.callRealMethod()
            throw ai.storyfork.content.attachment.domain.AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "저장소 요청 실패")
        }.`when`(storage).delete(org.mockito.ArgumentMatchers.anyString())
        org.mockito.Mockito.doThrow(ai.storyfork.content.attachment.domain.AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "복원 실패"))
            .`when`(storage).upload(org.mockito.ArgumentMatchers.eq(key) ?: "",
                org.mockito.ArgumentMatchers.any(ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload::class.java)
                    ?: ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload(ByteArray(0), ""))
        try {
            val failed = delete(path, owner)
            assertEquals(503, failed.statusCode()); assertEquals("ATTACHMENT_RECOVERY_REQUIRED", node(failed).path("code").asText())
            assertEquals(200, get(path, owner).statusCode()); assertEquals(503, get("$path/content", owner).statusCode())
        } finally {
            s3.putObject({ it.bucket("issue87-test").key(key).contentType("text/plain") }, software.amazon.awssdk.core.sync.RequestBody.fromBytes(bytes))
        }
        assertArrayEquals(bytes, get("$path/content", owner).body())
    }

    @Test fun `database flush and deferred commit failure keep the existing downloadable reference`() {
        val owner = actor(); val base = fixture(owner)
        val created = upload(base, owner); assertEquals(201, created.statusCode())
        val id = node(created).path("id").asText(); val path = "$base/$id"
        jdbc.execute("ALTER TABLE setting_attachment ADD CONSTRAINT issue87_reject_filename CHECK(filename <> 'reject-db.txt')")
        try {
            assertEquals(503, upload(base, owner, "new".toByteArray(), "reject-db.txt", "text/plain").statusCode())
            assertEquals(503, upload(path, owner, "new".toByteArray(), "reject-db.txt", "text/plain", "PUT").statusCode())
            assertEquals(1, node(get(base, owner)).path("attachments").size())
            assertArrayEquals(png, get("$path/content", owner).body())
        } finally { jdbc.execute("ALTER TABLE setting_attachment DROP CONSTRAINT issue87_reject_filename") }
        // Test-only deferred trigger exercises real PostgreSQL commit failure after object deletion.
        jdbc.execute("""CREATE FUNCTION issue87_fail_commit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''issue87 deferred failure''; END'""")
        jdbc.execute("""CREATE CONSTRAINT TRIGGER issue87_commit_failure AFTER UPDATE OR DELETE ON setting_attachment
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION issue87_fail_commit()""")
        try {
            val failed = upload(path, owner, "new".toByteArray(), "commit-failure.txt", "text/plain", "PUT")
            assertEquals(503, failed.statusCode()); assertFalse(String(failed.body()).contains("issue87 deferred"))
            assertEquals("map.png", node(get(path, owner)).path("filename").asText())
            assertEquals(200, get("$path/content", owner).statusCode()); assertArrayEquals(png, get("$path/content", owner).body())
            assertEquals(503, delete(path, owner).statusCode())
            assertEquals(200, get("$path/content", owner).statusCode()); assertArrayEquals(png, get("$path/content", owner).body())
        } finally {
            jdbc.execute("DROP TRIGGER issue87_commit_failure ON setting_attachment")
            jdbc.execute("DROP FUNCTION issue87_fail_commit()")
        }
    }

    @Test fun `following Fork cannot access source attachments and IDs never cross local settings`() {
        val owner = actor(); val reader = actor(); val base = fixture(owner)
        val created = upload(base, owner); assertEquals(201, created.statusCode())
        val workId = base.split('/')[4]; val settingId = base.split('/')[6]
        val world = content.world(workId, owner.id)
        content.commitSetting(workId, settingId, owner.id, world.revision)
        val draft = content.edit(workId, owner.id, DraftRequest("회차", "원고", 0))
        content.publish(workId, owner.id, PublishRequest(draft.revision, true, true, true, content.history(workId, owner.id).versions.last().id))
        val fork = content.fork(workId, reader.id, ForkRequest(1, "따라가는 Fork"))
        assertEquals(404, get(base.replace(workId, fork.id), reader).statusCode())
        assertEquals(404, upload(base.replace(workId, fork.id), reader).statusCode())
        val anotherBase = fixture(owner)
        assertEquals(404, get("$anotherBase/${node(created).path("id").asText()}/content", owner).statusCode())
        assertEquals(404, get("/api/v1/public/works/$workId/settings/$settingId/attachments", null).statusCode())
    }

    @Test fun `invalid empty oversized and unsafe content is rejected without adding references`() {
        val owner = actor(); val base = fixture(owner)
        val cases = listOf(
            Triple(ByteArray(0), "empty.png", "image/png"),
            Triple("not an image".toByteArray(), "fake.png", "image/png"),
            Triple("<svg onload='alert(1)'/>".toByteArray(), "bad.svg", "image/svg+xml"),
            Triple(png, "../bad.png", "image/png"),
            Triple(png, "bad.exe", "image/png"),
            Triple(image("png", 4097), "wide.png", "image/png"),
            Triple(byteArrayOf(0, 1, 2), "binary.txt", "text/plain"),
            Triple("not PDF".toByteArray(), "fake.pdf", "application/pdf"),
            Triple(png.copyOf(30), "truncated.png", "image/png"),
        )
        for ((bytes, filename, type) in cases) {
            val response = upload(base, owner, bytes, filename, type)
            assertEquals(422, response.statusCode(), "$filename: ${response.statusCode()} ${String(response.body())}")
            assertTrue(node(response).path("code").asText().startsWith("ATTACHMENT_"))
        }
        for (name in listOf("big.png", "big.txt")) {
            val oversized = upload(base, owner, ByteArray(10*1024*1024+1), name, "application/octet-stream")
            assertEquals(413, oversized.statusCode())
            assertEquals("ATTACHMENT_TOO_LARGE", node(oversized).path("code").asText())
        }
        assertTrue(node(get(base, owner)).path("attachments").isEmpty)
    }
}
