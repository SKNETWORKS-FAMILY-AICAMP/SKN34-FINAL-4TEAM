package ai.storyfork.content.attachment.helper

import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.dto.AttachmentUploadPayload
import ai.storyfork.content.attachment.service.dto.AttachmentUploadRequest
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import javax.imageio.ImageIO
import javax.imageio.stream.MemoryCacheImageInputStream

object AttachmentUploadHelper {
    const val MAX_BYTES = 10 * 1024 * 1024
    private fun invalid(): Nothing = throw AttachmentFailure(422, "ATTACHMENT_INVALID", "파일명·형식·이미지 내용을 확인해 주세요.")

    fun validate(request: AttachmentUploadRequest): AttachmentUploadPayload {
        val file = request.file ?: invalid()
        val name = file.originalFilename ?: invalid()
        if (!name.matches(Regex("[\\p{L}\\p{N} _().-]{1,120}")) || name.startsWith('.') || ".." in name || name.trim() != name) invalid()
        if (file.size > MAX_BYTES) throw AttachmentFailure(413, "ATTACHMENT_TOO_LARGE", "파일은 10 MiB 이하만 업로드할 수 있어요.")
        val bytes = try { file.inputStream.use { it.readNBytes(MAX_BYTES + 1) } } catch (_: Exception) { invalid() }
        if (bytes.size > MAX_BYTES) throw AttachmentFailure(413, "ATTACHMENT_TOO_LARGE", "파일은 10 MiB 이하만 업로드할 수 있어요.")
        if (bytes.isEmpty()) invalid()
        val type = when (name.substringAfterLast('.', "").lowercase()) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "txt" -> "text/plain"
            "md" -> "text/markdown"
            "csv" -> "text/csv"
            "pdf" -> "application/pdf"
            else -> invalid()
        }
        val suppliedType = file.contentType?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
        val alias = when (type) { "text/markdown" -> "text/x-markdown"; "text/csv" -> "application/vnd.ms-excel"; else -> type }
        if (suppliedType !in setOf(type, alias, "application/octet-stream", null)) invalid()
        if (type.startsWith("image/")) validateImage(bytes, type)
        else if (type == "application/pdf") {
            val header = bytes.take(9).toByteArray().toString(Charsets.US_ASCII)
            if (!header.matches(Regex("%PDF-[12]\\.[0-9][\\r\\n]")) || !bytes.takeLast(2048).toByteArray().toString(Charsets.ISO_8859_1).trimEnd().endsWith("%%EOF")) invalid()
        } else {
            val text = try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)) } catch (_: Exception) { invalid() }
            if (text.any { Character.isISOControl(it) && it !in "\t\r\n" }) invalid()
        }
        return AttachmentUploadPayload(name, type, if (type.startsWith("image/")) "IMAGE" else "FILE", bytes)
    }

    private fun validateImage(bytes: ByteArray, type: String) {
        if (type == "image/png" && !bytes.takeLast(12).toByteArray().contentEquals(byteArrayOf(0,0,0,0,73,69,78,68,-82,66,96,-126))) invalid()
        if (type == "image/jpeg" && (bytes.size < 4 || bytes[0].toInt() != -1 || bytes[1].toInt() != -40 || bytes[bytes.size-2].toInt() != -1 || bytes.last().toInt() != -39)) invalid()
        try {
            MemoryCacheImageInputStream(ByteArrayInputStream(bytes)).use { input ->
                val readers = ImageIO.getImageReaders(input)
                if (!readers.hasNext()) invalid()
                val reader = readers.next()
                try {
                    if (reader.formatName.lowercase() != if (type == "image/png") "png" else "jpeg") invalid()
                    reader.setInput(input, true, true)
                    val width = reader.getWidth(0); val height = reader.getHeight(0)
                    if (width !in 1..4096 || height !in 1..4096 || width.toLong()*height > 16_000_000) invalid()
                    if (reader.read(0) == null) invalid()
                } finally { reader.dispose() }
            }
        } catch (e: AttachmentFailure) { throw e } catch (_: Exception) { invalid() }
    }
}
