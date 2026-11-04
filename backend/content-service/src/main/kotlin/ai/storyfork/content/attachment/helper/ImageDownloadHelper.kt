package ai.storyfork.content.attachment.helper

import ai.storyfork.content.attachment.service.dto.AttachmentDownloadResult
import org.springframework.http.*
import java.nio.charset.StandardCharsets

object ImageDownloadHelper {
    fun response(result: AttachmentDownloadResult): ResponseEntity<ByteArray> = ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(result.attachment.mediaType)).contentLength(result.attachment.byteSize)
        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(result.attachment.filename, StandardCharsets.UTF_8).build().toString())
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store").header("X-Content-Type-Options", "nosniff").body(result.bytes)
}
