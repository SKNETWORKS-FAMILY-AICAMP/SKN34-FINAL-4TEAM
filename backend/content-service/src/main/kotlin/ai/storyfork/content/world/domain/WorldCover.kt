package ai.storyfork.content.world.domain

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.springframework.web.multipart.MultipartFile

/** 세계관 표지 업로드의 크기 상한(5MB)이다. 요청 본문 상한은 nginx(`client_max_body_size`)와 multipart 설정이 따로 건다. */
const val WORLD_COVER_MAX_BYTES = 5 * 1024 * 1024

/** 표지 업로드 검사를 통과한 바이트와, 그 바이트가 정한 형식(image/png·image/jpeg·image/webp)이다. */
class WorldCoverFile(val bytes: ByteArray, val contentType: String)

private fun coverInvalid() = ContentFailure(422, "표지는 5MB 이하의 PNG·JPEG·WebP 이미지만 올릴 수 있어요.", "WORLD_INPUT_INVALID")

private fun ByteArray.startsWith(vararg prefix: Int) = size >= prefix.size && prefix.indices.all { this[it] == prefix[it].toByte() }

private fun ByteArray.ascii(from: Int, length: Int) = String(this, from, length, Charsets.US_ASCII)

/** RIFF 시그니처, RIFF 크기(전체 − 8)와 실제 길이의 일치, WEBP 형식, VP8·VP8L·VP8X 중 하나인 첫 chunk를 확인한다. */
private fun isWebp(bytes: ByteArray): Boolean {
    if (bytes.size < 20 || bytes.ascii(0, 4) != "RIFF" || bytes.ascii(8, 4) != "WEBP" || bytes.ascii(12, 4) !in setOf("VP8 ", "VP8L", "VP8X")) return false
    return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).getInt(4) == bytes.size - 8
}

/**
 * 업로드 바이트의 실제 시그니처로 표지 형식을 정한다. 클라이언트가 보낸 형식·파일명은 믿지 않는다.
 * PNG·JPEG는 첨부와 같은 디코딩 검사([AttachmentUploadHelper.validateImage])를 거치고, JDK가 못 읽는 WebP는 RIFF 컨테이너 구조만 확인한다.
 * 비었거나 5MB를 넘거나 알 수 없는 형식·깨진 이미지는 422 `WORLD_INPUT_INVALID`다.
 * ponytail: WebP는 디코딩하지 않아 구조만 맞춘 깨진 이미지는 통과한다(브라우저가 못 그릴 뿐 해롭지 않다). 문제가 되면 WebP 디코더를 둔다.
 */
fun worldCoverType(bytes: ByteArray): String {
    if (bytes.isEmpty() || bytes.size > WORLD_COVER_MAX_BYTES) throw coverInvalid()
    if (isWebp(bytes)) return "image/webp"
    val type = when {
        bytes.startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) -> "image/png"
        bytes.startsWith(0xFF, 0xD8, 0xFF) -> "image/jpeg"
        else -> throw coverInvalid()
    }
    try { AttachmentUploadHelper.validateImage(bytes, type) } catch (_: AttachmentFailure) { throw coverInvalid() }
    return type
}

/** 업로드 파일을 읽어 표지로 검사한다. 없거나 5MB를 넘으면 바이트를 읽기 전에 422이고, 파일명과 보낸 형식은 보지 않는다. */
fun worldCoverFile(file: MultipartFile?): WorldCoverFile {
    if (file == null || file.size > WORLD_COVER_MAX_BYTES) throw coverInvalid()
    val bytes = try { file.bytes } catch (_: IOException) { throw coverInvalid() }
    return WorldCoverFile(bytes, worldCoverType(bytes))
}

/** 표지 객체 저장소(첨부와 같은 MinIO) 호출의 실패(고정 문구의 503 등)를 세계관 API의 공개 실패로 바꾼다. */
fun <T> coverStorage(call: () -> T): T = try { call() } catch (e: AttachmentFailure) { throw ContentFailure(e.status, e.message, e.code) }
