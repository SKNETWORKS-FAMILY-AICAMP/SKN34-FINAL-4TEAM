package ai.storyfork.content.manuscript

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content.manuscript.controller.ManuscriptController
import ai.storyfork.content.manuscript.service.ManuscriptExportService
import ai.storyfork.content.manuscript.service.ManuscriptImportService
import ai.storyfork.content.manuscript.service.dto.*
import java.security.Principal
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockMultipartFile
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestControllerAdvice

class ManuscriptControllerTest {
    private val imports = mock(ManuscriptImportService::class.java)
    private val exports = mock(ManuscriptExportService::class.java)
    private val controller = ManuscriptController(imports, exports)
    private val principal = Principal { "owner" }

    @Test fun `export is a never cached attachment whose UTF-8 file name survives the header`() {
        val bytes = "본문".toByteArray()
        `when`(exports.export("work", "owner", "txt", "draft", 2)).thenReturn(ManuscriptExportResult(bytes, "text/plain;charset=UTF-8", "내 소설.txt"))
        val response = controller.export("work", principal, "txt", "draft", 2)
        assertEquals(200, response.statusCode.value()); assertArrayEquals(bytes, response.body)
        assertEquals("text/plain;charset=UTF-8", response.headers.getFirst(HttpHeaders.CONTENT_TYPE))
        assertEquals(bytes.size.toLong(), response.headers.contentLength)
        val disposition = response.headers.getFirst(HttpHeaders.CONTENT_DISPOSITION)!!
        assertEquals("attachment; filename*=UTF-8''%EB%82%B4%20%EC%86%8C%EC%84%A4.txt", disposition)
        assertEquals("내 소설.txt", ContentDisposition.parse(disposition).filename)
        assertEquals("private, no-store", response.headers.cacheControl); assertEquals("nosniff", response.headers.getFirst("X-Content-Type-Options"))
    }

    @Test fun `import endpoints hand the signed in owner the file and the request to the services`() {
        val file = MockMultipartFile("file", "novel.txt", "text/plain", "1화\n본문".toByteArray())
        val request = ManuscriptImportRequest(true, listOf(ManuscriptImportItem(1, "1화", 0, 2)))
        val preview = ManuscriptPreviewResponse("txt", "line", 2, 0, emptyList())
        val result = ManuscriptImportResponse(1, 0, listOf(ManuscriptImportResult(1, "1화", "created", null, 0)))
        `when`(imports.preview("work", "owner", file)).thenReturn(preview)
        `when`(imports.confirm("work", "owner", file, request)).thenReturn(result)
        assertSame(preview, controller.preview("work", principal, file))
        assertSame(result, controller.confirm("work", principal, file, request))
    }

    @Test fun `routes are the contract paths and the package uses the content error body`() {
        val method = { name: String -> ManuscriptController::class.java.methods.first { it.name == name } }
        assertEquals(listOf("/manuscript-imports/preview"), AnnotatedElementUtils.findMergedAnnotation(method("preview"), PostMapping::class.java)!!.value.toList())
        assertEquals(listOf("/manuscript-imports"), AnnotatedElementUtils.findMergedAnnotation(method("confirm"), PostMapping::class.java)!!.value.toList())
        assertEquals(listOf("/manuscript-imports/bulk"), AnnotatedElementUtils.findMergedAnnotation(method("bulkBasis"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/manuscript-imports/bulk"), AnnotatedElementUtils.findMergedAnnotation(method("importBulk"), PostMapping::class.java)!!.value.toList())
        assertNull(AnnotatedElementUtils.findMergedAnnotation(method("export"), PatchMapping::class.java))
        val advice = AnnotatedElementUtils.findMergedAnnotation(ContentExceptionHandler::class.java, RestControllerAdvice::class.java)!!
        assertTrue("ai.storyfork.content.manuscript.controller" in advice.basePackages)
        assertEquals("ai.storyfork.content.manuscript.controller", ManuscriptController::class.java.packageName)
    }

    @Test fun `bulk import uses the authenticated owner and keeps the basis response out of caches`() {
        val basis = BulkImportBasis(2, 7)
        val files = listOf(
            MockMultipartFile("files", "2화.txt", "text/plain", "둘째".toByteArray()),
            MockMultipartFile("files", "3화.epub", "application/epub+zip", byteArrayOf(1)),
        )
        val request = BulkImportRequest(true, 7, listOf(BulkImportItem(2, "2화"), BulkImportItem(3, "3화")))
        val result = BulkImportResponse(8, listOf(
            BulkImportResult(2, "2화", "versioned", versionId = "v2"),
            BulkImportResult(3, "3화", "failed", reason = "파일을 읽지 못했어요."),
        ))
        `when`(imports.bulkBasis("work", "owner")).thenReturn(basis)
        `when`(imports.importBulk("work", "owner", files, request)).thenReturn(result)
        val response = controller.bulkBasis("work", principal)
        assertSame(basis, response.body)
        assertEquals("no-store", response.headers.cacheControl)
        assertSame(result, controller.importBulk("work", principal, files, request))
    }
}
