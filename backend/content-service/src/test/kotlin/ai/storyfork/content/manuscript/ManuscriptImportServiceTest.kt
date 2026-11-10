package ai.storyfork.content.manuscript

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.dto.AttachmentResponse
import ai.storyfork.content.attachment.service.dto.AttachmentUploadPayload
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.manuscript.EpubFixture.epub
import ai.storyfork.content.manuscript.EpubFixture.xhtml
import ai.storyfork.content.manuscript.service.ManuscriptImportService
import ai.storyfork.content.manuscript.service.dto.*
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.*
import org.springframework.mock.web.MockMultipartFile
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.multipart.MultipartFile

class ManuscriptImportServiceTest {
    private val episodes = mock(EpisodeService::class.java)
    private val versions = mock(EpisodeVersionService::class.java)
    private val attachments = mock(AttachmentService::class.java)
    private val manager = mock(PlatformTransactionManager::class.java)
    private val service = ManuscriptImportService(episodes, versions, attachments, TransactionTemplate(manager))

    // 실제 서비스 대신 메모리에 회차를 두고, 서비스가 부른 일을 기록한다.
    private val store = sortedMapOf<Int, EpisodeResponse>()
    private val saved = mutableListOf<Triple<Int, String, String>>()
    private val created = mutableListOf<Int>()
    private val deleted = mutableListOf<Pair<Int, Int>>()
    private val uploads = mutableListOf<AttachmentUploadPayload>()
    private val uploadAlts = mutableListOf<String>()
    private val discarded = mutableListOf<String>()
    private var attempts = 0
    private var saveFailure: (Int) -> Throwable? = { null }
    private var uploadFailure: (Int) -> Throwable? = { null }
    private var createOffset = 0

    private fun str(value: String) = eq(value) ?: value
    private fun <T> anyOf(type: Class<T>, fallback: T): T = any(type) ?: fallback
    private fun version(number: Int, title: String, body: String) = VersionResponse("v-$number-$title", title, body, 1, number, "2026-11-09T00:00:00Z")
    // 현재 초안과 저장 버전 이력(마지막이 최신)을 직접 정한 기존 회차.
    private fun existing(number: Int, draft: DraftResponse, history: List<VersionResponse>, hasDraft: Boolean = true, inherited: Boolean = false) =
        EpisodeResponse(number, draft, history, null, inherited, null, hasDraft = hasDraft).also { store[number] = it }
    // 기본 기존 회차: 현재 초안이 최신 저장 버전과 같다(보존할 미저장 입력 없음).
    private fun episode(number: Int, revision: Int = 5, inherited: Boolean = false) =
        existing(number, DraftResponse("기존 $number", "기존 본문", revision), listOf(version(number, "기존 $number", "기존 본문")), inherited = inherited)

    @BeforeEach fun wire() {
        `when`(manager.getTransaction(any())).thenReturn(SimpleTransactionStatus())
        `when`(episodes.list(str("work"), str("owner"))).thenAnswer { EpisodeListResponse(store.values.toList()) }
        `when`(episodes.read(str("work"), str("owner"), anyInt())).thenAnswer { store[it.getArgument<Int>(2)] ?: throw ContentFailure(404, "회차를 찾을 수 없어요.") }
        `when`(episodes.create(str("work"), str("owner"), anyOf(CreateEpisodeRequest::class.java, CreateEpisodeRequest("x")))).thenAnswer {
            val number = (store.keys.maxOrNull() ?: 0) + 1 + createOffset
            created += number
            EpisodeResponse(number, DraftResponse(it.getArgument<CreateEpisodeRequest>(2).title, "", 7), emptyList(), null, false, null).also { made -> store[number] = made }
        }
        `when`(versions.save(str("work"), str("owner"), anyInt(), anyOf(DraftRequest::class.java, DraftRequest("x", "", 0)))).thenAnswer {
            val number = it.getArgument<Int>(2); val data = it.getArgument<DraftRequest>(3)
            saveFailure(number)?.let { failure -> throw failure }
            val before = store[number] ?: throw ContentFailure(404, "회차를 찾을 수 없어요.")
            if (before.inherited) throw ContentFailure(403, "원작 기준 회차는 수정할 수 없어요.")
            if (data.revision != before.draft.revision) throw ContentFailure(409, "revision ${data.revision} != ${before.draft.revision}")
            saved += Triple(number, data.title, data.body)
            before.copy(draft = DraftResponse(data.title, data.body, data.revision + 1), versions = before.versions + version(number, data.title, data.body)).also { after -> store[number] = after }
        }
        `when`(attachments.createEpisodeImage(str("work"), anyInt(), str("owner"), anyOf(AttachmentUploadPayload::class.java, AttachmentUploadPayload("", "", "", ByteArray(0))), anyString())).thenAnswer {
            val payload = it.getArgument<AttachmentUploadPayload>(3)
            uploadFailure(attempts++)?.let { failure -> throw failure }
            uploads += payload; uploadAlts += it.getArgument<String>(4)
            AttachmentResponse("img-${uploads.size}", payload.filename, payload.mediaType, "IMAGE", payload.bytes.size.toLong(), Instant.now(), "/image")
        }
        doAnswer { deleted += it.getArgument<Int>(2) to it.getArgument<Int>(3); store.remove(it.getArgument<Int>(2)); null }
            .`when`(episodes).deleteEpisode(str("work"), str("owner"), anyInt(), anyInt())
        doAnswer { discarded += it.getArgument<String>(2); null }
            .`when`(attachments).discardUnreferencedEpisodeImage(str("work"), anyInt(), anyString(), str("owner"))
    }

    // "1화\n본문1\n2화\n본문2…" 형태의 TXT. n번째 회차는 줄 [2(n-1), 2n)이다.
    private fun novel(count: Int) = MockMultipartFile("file", "novel.txt", "text/plain", (1..count).joinToString("\n") { "${it}화\n본문$it" }.toByteArray())
    private fun item(number: Int, episode: Int, title: String = "$number 번째") = ManuscriptImportItem(number, title, 2 * (episode - 1), 2 * episode)
    private fun confirm(file: MultipartFile, vararg items: ManuscriptImportItem, rights: Boolean = true) = service.confirm("work", "owner", file, ManuscriptImportRequest(rights, items.toList()))
    private fun statuses(response: ManuscriptImportResponse) = response.results.map { "${it.number}:${it.status}" }
    private fun invalid(file: MultipartFile?, request: ManuscriptImportRequest?) = assertThrows(ContentFailure::class.java) { service.confirm("work", "owner", file, request) }
        .also { assertEquals(422, it.status, it.message) }
    private fun epubFile(vararg chapters: String, extra: Map<String, ByteArray> = emptyMap()) = MockMultipartFile("file", "book.epub", "application/epub+zip",
        epub(chapters.mapIndexed { i, body -> "c$i.xhtml" to xhtml(body) }, nav = chapters.indices.map { "c$it.xhtml" to "${it + 1}화" }, extra = extra))

    // ---- 미리보기 ----

    @Test fun `TXT preview reports positions sizes excerpts and the current episode count without saving`() {
        episode(1); episode(2); episode(3)
        val body = "가".repeat(400)
        val response = service.preview("work", "owner", MockMultipartFile("file", "novel.TXT", "text/plain", "1화 시작\n$body\n2화\n짧음".toByteArray()))
        assertEquals(listOf("txt", "line", 4, 3), listOf(response.format, response.unit, response.unitCount, response.existingEpisodeCount))
        val (first, second) = response.episodes
        assertEquals(listOf("1화 시작", 0, 2, 400, 0), listOf(first.title, first.from, first.to, first.charCount, first.imageCount))
        assertEquals(body.take(300), first.excerpt); assertTrue(first.warnings.isEmpty())
        assertEquals(listOf("2화", 2, 4, 2, "짧음"), listOf(second.title, second.from, second.to, second.charCount, second.excerpt))
        verifyNoInteractions(versions, attachments); verify(episodes, never()).create(str("work"), str("owner"), anyOf(CreateEpisodeRequest::class.java, CreateEpisodeRequest("x")))
    }

    @Test fun `TXT preview warns about an episode body over 40000 characters`() {
        val file = MockMultipartFile("file", "a.txt", "text/plain", "1화\n${"가".repeat(40_001)}\n2화\n${"가".repeat(40_000)}".toByteArray())
        val (long, exact) = service.preview("work", "owner", file).episodes
        assertEquals(listOf("본문이 40,000자를 넘어 등록할 수 없어요."), long.warnings); assertTrue(exact.warnings.isEmpty())
    }

    @Test fun `EPUB preview counts images by marker size and reports dropped images unreadable chapters and the ten image ceiling`() {
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png)
        val twelve = "<p>가</p>" + "<img src=\"images/a.png\"/>".repeat(12)
        val nearLimit = "<p>${"가".repeat(39_960)}</p><img src=\"images/a.png\"/>"
        val file = MockMultipartFile("file", "book.epub", "application/epub+zip", epub(listOf(
            "c0.xhtml" to xhtml("<p>가</p><img src=\"images/a.png\"/><img src=\"images/x.gif\"/>"), "c1.xhtml" to xhtml(twelve), "c2.xhtml" to "<broken", "c3.xhtml" to xhtml(nearLimit),
        ), nav = listOf("c0.xhtml" to "1화", "c3.xhtml" to "4화"), extra = extra))
        val response = service.preview("work", "owner", file)
        assertEquals(listOf("epub", "chapter", 4, 0), listOf(response.format, response.unit, response.unitCount, response.existingEpisodeCount))
        val (one, two, broken, near) = response.episodes
        assertEquals(listOf("1화", 0, 1, 3 + 45, 1), listOf(one.title, one.from, one.to, one.charCount, one.imageCount))
        assertEquals("가\n[이미지]", one.excerpt); assertEquals(listOf("지원하지 않는 이미지 1개는 빠져요."), one.warnings)
        assertEquals(listOf("회차당 이미지는 10개까지라 2개는 빠져요."), two.warnings); assertEquals(12, two.imageCount)
        assertEquals(listOf("이 장을 읽지 못했어요."), broken.warnings)
        assertEquals(listOf("본문이 40,000자를 넘어 등록할 수 없어요."), near.warnings)
    }

    @Test fun `preview rejects missing unsupported oversized and unreadable files and keeps ownership first`() {
        fun failure(file: MultipartFile?) = assertThrows(ContentFailure::class.java) { service.preview("work", "owner", file) }
        assertEquals(422, failure(null).status)
        val pdf = failure(MockMultipartFile("file", "a.pdf", "application/pdf", ByteArray(3)))
        assertEquals(422, pdf.status); assertTrue(".txt" in pdf.message && ".epub" in pdf.message, pdf.message)
        assertEquals(422, failure(MockMultipartFile("file", "noext", "text/plain", "x".toByteArray())).status)
        fun big(name: String, size: Long) = mock(MultipartFile::class.java).also { `when`(it.originalFilename).thenReturn(name); `when`(it.size).thenReturn(size) }
        val txt = failure(big("a.txt", 10L * 1024 * 1024 + 1)); assertEquals(413, txt.status); assertTrue("TXT" in txt.message && "10MB" in txt.message, txt.message)
        val epub = failure(big("a.epub", 50L * 1024 * 1024 + 1)); assertEquals(413, epub.status); assertTrue("EPUB" in epub.message && "50MB" in epub.message, epub.message)
        assertEquals(422, failure(MockMultipartFile("file", "a.epub", "application/epub+zip", "text".toByteArray())).status)
        assertEquals(422, failure(MockMultipartFile("file", "a.txt", "text/plain", byteArrayOf(0xFF.toByte(), 0xFE.toByte()))).status)
        val drm = failure(MockMultipartFile("file", "a.epub", "application/epub+zip", epub(listOf("c.xhtml" to xhtml("<p>x</p>")), extra = mapOf("META-INF/rights.xml" to "<r/>".toByteArray()))))
        assertTrue("DRM" in drm.message, drm.message)
        `when`(episodes.list(str("work"), str("stranger"))).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.preview("work", "stranger", MockMultipartFile("file", "a.epub", "x", "garbage".toByteArray())) }.status)
    }

    @Test fun `episode counts of 300 pass and 301 are refused in both formats`() {
        fun txt(count: Int) = MockMultipartFile("file", "a.txt", "text/plain", (1..count).joinToString("\n") { "${it}화\n본문" }.toByteArray())
        assertEquals(300, service.preview("work", "owner", txt(300)).episodes.size)
        val failure = assertThrows(ContentFailure::class.java) { service.preview("work", "owner", txt(301)) }
        assertEquals(422, failure.status); assertTrue("300" in failure.message, failure.message)
    }

    // ---- 확정: 번호 규칙 ----

    @Test fun `numbers up to the current count get a new version the next number is created and later numbers fail`() {
        episode(1); episode(2); episode(3)
        val response = confirm(novel(4), item(2, 1, "고친 2화"), item(4, 2), item(5, 3), item(7, 4))
        assertEquals(listOf("2:versioned", "4:created", "5:created", "7:failed"), statuses(response))
        assertEquals(listOf(3, 1), listOf(response.succeeded, response.failed))
        assertEquals(listOf(Triple(2, "고친 2화", "본문1"), Triple(4, "4 번째", "본문2"), Triple(5, "5 번째", "본문3")), saved)
        assertEquals(listOf(4, 5), created)
        assertEquals("앞 회차가 없어 등록할 수 없어요.", response.results.last().reason)
        assertTrue(response.results.dropLast(1).all { it.reason == null && it.missingImages == 0 })
        assertTrue(uploads.isEmpty())
    }

    @Test fun `a failed episode leaves a gap that fails every later number`() {
        episode(1)
        saveFailure = { if (it == 2) ContentFailure(409, "다른 편집이 저장됐어요.") else null }
        val response = confirm(novel(3), item(2, 1), item(3, 2), item(4, 3))
        assertEquals(listOf("2:failed", "3:failed", "4:failed"), statuses(response))
        assertEquals(listOf("다른 편집이 저장됐어요.", "앞 회차가 없어 등록할 수 없어요.", "앞 회차가 없어 등록할 수 없어요."), response.results.map { it.reason })
        assertEquals(listOf(0, 3), listOf(response.succeeded, response.failed))
        assertTrue(saved.isEmpty())
    }

    @Test fun `without earlier episodes only number one can start and excluded episodes keep their numbers`() {
        assertEquals(listOf("2:failed", "3:failed"), statuses(confirm(novel(3), item(2, 1), item(3, 3))))
        val response = confirm(novel(3), item(1, 1), item(2, 3))
        assertEquals(listOf("1:created", "2:created"), statuses(response))
        assertEquals(listOf(Triple(1, "1 번째", "본문1"), Triple(2, "2 번째", "본문3")), saved)
    }

    @Test fun `an inherited episode cannot receive a version`() {
        episode(1, inherited = true); episode(2)
        val response = confirm(novel(3), item(1, 1), item(2, 2), item(3, 3))
        assertEquals(listOf("1:failed", "2:versioned", "3:created"), statuses(response))
        assertEquals("원작 기준 회차는 수정할 수 없어요.", response.results.first().reason)
        assertEquals(listOf(2, 3), saved.map { it.first })
    }

    // ---- 확정: 기존 회차의 현재 초안은 덮어쓰기 전에 저장 버전으로 보존한다 (UC-03 E4) ----

    @Test fun `a current draft that differs from the latest saved version is kept as a saved version first`() {
        episode(1)
        existing(2, DraftResponse("2화", "고친 본문", 5), listOf(version(2, "2화", "예전 본문")))
        existing(3, DraftResponse("바뀐 제목", "같은 본문", 9), listOf(version(3, "원래 제목", "같은 본문")))
        existing(4, DraftResponse("첫 입력", "저장 안 한 본문", 2), emptyList())
        val response = confirm(novel(4), item(2, 2, "가져온 2화"), item(3, 3, "가져온 3화"), item(4, 4, "가져온 4화"))
        assertEquals(listOf("2:versioned", "3:versioned", "4:versioned"), statuses(response))
        // 보존 버전(현재 초안 그대로) 다음에 가져온 원고가 쌓인다. 제목만 달라도, 저장 버전이 없어도 보존한다.
        assertEquals(listOf(
            Triple(2, "2화", "고친 본문"), Triple(2, "가져온 2화", "본문2"),
            Triple(3, "바뀐 제목", "같은 본문"), Triple(3, "가져온 3화", "본문3"),
            Triple(4, "첫 입력", "저장 안 한 본문"), Triple(4, "가져온 4화", "본문4"),
        ), saved)
        assertEquals(listOf("예전 본문", "고친 본문", "본문2"), store.getValue(2).versions.map { it.body })
        // 두 번째 저장은 보존 저장이 올린 revision을 쓴다(어긋나면 409로 실패한다).
        assertEquals(DraftResponse("가져온 2화", "본문2", 7), store.getValue(2).draft)
        assertEquals(DraftResponse("가져온 4화", "본문4", 4), store.getValue(4).draft)
    }

    @Test fun `a draft already saved as the latest version is not saved again`() {
        existing(1, DraftResponse("셋", "셋 본문", 4), listOf(version(1, "하나", "하나 본문"), version(1, "둘", "둘 본문"), version(1, "셋", "셋 본문")))
        assertEquals(listOf("1:versioned"), statuses(confirm(novel(1), item(1, 1))))
        assertEquals(listOf(Triple(1, "1 번째", "본문1")), saved)
        assertEquals(listOf("하나 본문", "둘 본문", "셋 본문", "본문1"), store.getValue(1).versions.map { it.body })
    }

    @Test fun `an empty draft such as the blank first episode of a new work is not kept`() {
        existing(1, DraftResponse("새 회차", "", 7), emptyList())
        // 저장된 원고에서 따온 초안(hasDraft=false)도 작성자의 미저장 입력이 아니다.
        existing(2, DraftResponse("저장본 제목", "저장본 본문", 0), emptyList(), hasDraft = false)
        assertEquals(listOf("1:versioned", "2:versioned"), statuses(confirm(novel(2), item(1, 1), item(2, 2))))
        assertEquals(listOf(Triple(1, "1 번째", "본문1"), Triple(2, "2 번째", "본문2")), saved)
    }

    @Test fun `an unsaved draft is kept before an EPUB version with images is stacked`() {
        existing(1, DraftResponse("초안", "저장 안 한 초안", 5), emptyList())
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png)
        val response = confirm(epubFile("<p>앞</p><img src=\"images/a.png\"/>", extra = extra), ManuscriptImportItem(1, "가져옴", 0, 1))
        assertEquals(listOf("1:versioned"), statuses(response))
        assertEquals(listOf(Triple(1, "초안", "저장 안 한 초안"), Triple(1, "가져옴", "앞\n[[image:img-1]]")), saved)
    }

    @Test fun `keeping the draft and stacking the import share one transaction so a failure undoes both`() {
        existing(1, DraftResponse("초안", "저장 안 한 초안", 5), emptyList())
        saveFailure = { if (saved.isNotEmpty()) ContentFailure(409, "다른 편집이 저장됐어요.") else null } // 보존 저장 뒤 가져온 버전 저장만 실패
        assertEquals(listOf("1:failed"), statuses(confirm(novel(1), item(1, 1))))
        // 시작 → 보존 저장 → 가져온 버전 저장(실패) → 롤백 순서라서 두 저장이 모두 같은 트랜잭션 안에 있다.
        val order = inOrder(manager, versions)
        order.verify(manager).getTransaction(any())
        order.verify(versions, times(2)).save(str("work"), str("owner"), anyInt(), anyOf(DraftRequest::class.java, DraftRequest("x", "", 0)))
        order.verify(manager).rollback(anyOf(TransactionStatus::class.java, SimpleTransactionStatus()))
    }

    @Test fun `a changed episode count is not silently saved onto the wrong episode`() {
        createOffset = 1
        val response = confirm(novel(1), item(1, 1))
        assertEquals(listOf("1:failed"), statuses(response))
        assertTrue(saved.isEmpty(), saved.toString())
    }

    @Test fun `merged ranges rebuild the body and titles are trimmed and limited to 120 characters`() {
        val merged = confirm(novel(3), ManuscriptImportItem(1, "  합친 회차  ", 0, 4), item(2, 3))
        assertEquals(listOf("1:created", "2:created"), statuses(merged))
        assertEquals(listOf(Triple(1, "합친 회차", "본문1\n2화\n본문2"), Triple(2, "2 번째", "본문3")), saved)
        assertEquals("합친 회차", merged.results.first().title)
    }

    @Test fun `episodes that break the title or body rules fail with their own reason`() {
        val file = MockMultipartFile("file", "a.txt", "text/plain", "1화\n${"가".repeat(40_001)}\n2화\n${"가".repeat(40_000)}\n3화\n본문".toByteArray())
        fun reason(item: ManuscriptImportItem) = confirm(file, item).results.single().reason
        assertEquals("본문이 40,000자를 넘어 등록할 수 없어요.", reason(ManuscriptImportItem(1, "너무 김", 0, 2)))
        assertEquals("제목은 1~120자로 입력해 주세요.", reason(ManuscriptImportItem(1, "   ", 2, 4)))
        assertEquals("제목은 1~120자로 입력해 주세요.", reason(ManuscriptImportItem(1, "가".repeat(121), 2, 4)))
        assertTrue(saved.isEmpty() && created.isEmpty())
        val ok = confirm(file, ManuscriptImportItem(1, "가".repeat(120), 2, 4))
        assertEquals(listOf("1:created"), statuses(ok)); assertEquals(40_000, saved.single().third.length)
    }

    @Test fun `a storage or database error is reported without leaking its message`() {
        saveFailure = { RuntimeException("jdbc:postgresql://secret-host password") }
        val response = confirm(novel(1), item(1, 1))
        assertEquals("저장하지 못했어요. 잠시 후 다시 시도해 주세요.", response.results.single().reason)
        assertFalse("secret" in response.results.single().reason!!)
    }

    // ---- 확정: 요청 검증은 아무것도 저장하지 않는다 ----

    @Test fun `invalid requests are refused as a whole before anything is saved`() {
        episode(1)
        val file = novel(3)
        fun request(vararg items: ManuscriptImportItem, rights: Boolean = true) = ManuscriptImportRequest(rights, items.toList())
        val one = item(2, 1)
        for (bad in listOf(
            request(one, rights = false), request(), ManuscriptImportRequest(true, List(301) { one }),
            request(ManuscriptImportItem(0, "t", 0, 2)), request(ManuscriptImportItem(-1, "t", 0, 2)),
            request(item(3, 1), item(2, 2)), request(item(2, 1), item(2, 2)),
            request(ManuscriptImportItem(2, "t", 2, 2)), request(ManuscriptImportItem(2, "t", 3, 2)), request(ManuscriptImportItem(2, "t", -1, 2)),
            request(ManuscriptImportItem(2, "t", 0, 7)), request(item(2, 1), ManuscriptImportItem(3, "t", 1, 4)), request(item(2, 2), item(3, 1)),
        )) invalid(file, bad)
        invalid(null, request(one)); invalid(file, null)
        verifyNoInteractions(versions, attachments)
        assertTrue(created.isEmpty() && saved.isEmpty())
    }

    @Test fun `file errors and ownership are reported before the request is used`() {
        val broken = MockMultipartFile("file", "a.epub", "application/epub+zip", "no zip".toByteArray())
        invalid(broken, ManuscriptImportRequest(true, listOf(item(1, 1))))
        `when`(episodes.list(str("work"), str("stranger"))).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.confirm("work", "stranger", broken, ManuscriptImportRequest(false, emptyList())) }.status)
        verifyNoInteractions(versions, attachments)
    }

    // ---- 확정: EPUB 이미지 ----

    @Test fun `EPUB images are uploaded after the episode exists and their markers replace the placeholders`() {
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png, "OEBPS/images/b.jpg" to EpubFixture.jpeg)
        val response = confirm(epubFile("<p>앞</p><img src=\"images/a.png\" alt=\" 지도 \"/><p>뒤</p><img src=\"images/b.jpg\"/><img src=\"images/a.png\" alt=\"다시\"/>", extra = extra), ManuscriptImportItem(1, "이미지 회차", 0, 1))
        assertEquals(listOf("1:created"), statuses(response)); assertEquals(0, response.results.single().missingImages); assertNull(response.results.single().reason)
        assertEquals(listOf(Triple(1, "이미지 회차", "앞\n[[image:img-1]]\n뒤\n[[image:img-2]]\n[[image:img-3]]")), saved)
        assertEquals(listOf("image/png", "image/jpeg", "image/png"), uploads.map { it.mediaType })
        assertEquals(listOf("지도", "", "다시"), uploadAlts)
        assertEquals(listOf("IMAGE"), uploads.map { it.kind }.distinct())
        assertTrue(uploads.all { it.filename.matches(Regex("image\\.(png|jpg)")) })
        assertArrayEquals(EpubFixture.png, uploads[0].bytes)
        val order = inOrder(episodes, attachments, versions)
        order.verify(episodes).create(str("work"), str("owner"), anyOf(CreateEpisodeRequest::class.java, CreateEpisodeRequest("x")))
        order.verify(attachments, times(3)).createEpisodeImage(str("work"), anyInt(), str("owner"), anyOf(AttachmentUploadPayload::class.java, AttachmentUploadPayload("", "", "", ByteArray(0))), anyString())
        order.verify(versions).save(str("work"), str("owner"), anyInt(), anyOf(DraftRequest::class.java, DraftRequest("x", "", 0)))
    }

    @Test fun `images that cannot be read validated or uploaded leave the episode partial with the rest of the body saved`() {
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png, "OEBPS/images/bad.png" to "not a png".toByteArray(), "OEBPS/images/b.jpg" to EpubFixture.jpeg, "OEBPS/images/d.png" to EpubFixture.png)
        uploadFailure = { if (it == 2) AttachmentFailure(409, "IMAGE_LIMIT", "회차 이미지는 최대 10개까지 추가할 수 있어요.") else null }
        val body = "<p>앞</p><img src=\"images/a.png\"/><img src=\"images/bad.png\"/><img src=\"images/b.jpg\"/><img src=\"images/gif.gif\"/><img src=\"images/d.png\"/><p>끝</p>"
        val response = confirm(epubFile(body, extra = extra), ManuscriptImportItem(1, "부분", 0, 1))
        val result = response.results.single()
        // 지원하지 않는 형식 1(gif) + 디코딩 실패 1(bad.png) + 업로드 실패 1(d.png)
        assertEquals(listOf("partial", 3, "이미지 3개를 가져오지 못했어요."), listOf(result.status, result.missingImages, result.reason))
        assertEquals(listOf(0, 1), listOf(response.failed, response.succeeded))
        assertEquals(listOf(Triple(1, "부분", "앞\n[[image:img-1]]\n[[image:img-2]]\n끝")), saved)
        assertEquals(listOf("image/png", "image/jpeg"), uploads.map { it.mediaType })
        assertTrue(discarded.isEmpty())
    }

    @Test fun `a version saved on an existing episode counts as partial too and keeps its number`() {
        episode(1)
        val response = confirm(epubFile("<p>본문</p><img src=\"images/none.png\"/>"), ManuscriptImportItem(1, "고침", 0, 1))
        assertEquals(listOf("1:partial"), statuses(response)); assertEquals(1, response.results.single().missingImages)
        assertEquals(listOf(Triple(1, "고침", "본문")), saved); assertTrue(created.isEmpty())
    }

    @Test fun `a failed save removes the uploaded images and the episode created for it`() {
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png, "OEBPS/images/b.png" to EpubFixture.png)
        saveFailure = { ContentFailure(409, "다른 편집이 저장됐어요.") }
        val response = confirm(epubFile("<img src=\"images/a.png\"/><img src=\"images/b.png\"/>", extra = extra), ManuscriptImportItem(1, "실패", 0, 1))
        assertEquals(listOf("1:failed"), statuses(response)); assertEquals("다른 편집이 저장됐어요.", response.results.single().reason)
        assertEquals(listOf("img-1", "img-2"), discarded)
        assertEquals(listOf(1 to 7), deleted)
        assertTrue(store.isEmpty())
        // 이어지는 번호는 공백이 생겨 등록되지 않는다.
        saveFailure = { null }
        assertEquals(listOf("2:failed"), statuses(confirm(epubFile("<p>x</p>"), ManuscriptImportItem(2, "다음", 0, 1))))
    }

    @Test fun `a failed save on an existing episode removes only the uploaded images and cleanup errors are not fatal`() {
        episode(1)
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png)
        saveFailure = { RuntimeException("commit failed") }
        doThrow(RuntimeException("object store down")).`when`(attachments).discardUnreferencedEpisodeImage(str("work"), anyInt(), anyString(), str("owner"))
        val response = confirm(epubFile("<img src=\"images/a.png\"/>", extra = extra), ManuscriptImportItem(1, "실패", 0, 1))
        assertEquals("저장하지 못했어요. 잠시 후 다시 시도해 주세요.", response.results.single().reason)
        verify(attachments).discardUnreferencedEpisodeImage("work", 1, "img-1", "owner")
        assertTrue(deleted.isEmpty()); assertNotNull(store[1])
        doThrow(RuntimeException("delete failed")).`when`(episodes).deleteEpisode(str("work"), str("owner"), anyInt(), anyInt())
        store.clear()
        assertEquals(listOf("1:failed"), statuses(confirm(epubFile("<img src=\"images/a.png\"/>", extra = extra), ManuscriptImportItem(1, "실패", 0, 1))))
    }

    @Test fun `an unreadable chapter fails its episode and the other chapters are still saved`() {
        val file = MockMultipartFile("file", "book.epub", "application/epub+zip", epub(listOf("a.xhtml" to xhtml("<p>정상</p>"), "b.xhtml" to "<broken", "c.xhtml" to xhtml("<p>뒤</p>")),
            nav = listOf("a.xhtml" to "가", "b.xhtml" to "나", "c.xhtml" to "다")))
        val response = confirm(file, ManuscriptImportItem(1, "가", 0, 1), ManuscriptImportItem(2, "나", 1, 2), ManuscriptImportItem(3, "다", 2, 3))
        assertEquals(listOf("1:created", "2:failed", "3:failed"), statuses(response))
        assertEquals(listOf("이 장을 읽지 못했어요.", "앞 회차가 없어 등록할 수 없어요."), response.results.drop(1).map { it.reason })
        assertEquals(listOf(Triple(1, "가", "정상")), saved)
    }
    @Test fun `import preserves note-only unsaved edits before replacing the manuscript`() {
        existing(1,DraftResponse("제목","본문",5,"후기만 수정"),listOf(version(1,"제목","본문")))
        confirm(novel(1),item(1,1))
        val requests=org.mockito.Mockito.mockingDetails(versions).invocations.filter {it.method.name=="save"}.map {it.getArgument<DraftRequest>(3)}
        assertEquals(2,requests.size)
        assertEquals(listOf("후기만 수정","후기만 수정"),requests.map {it.authorNote})
    }
}
