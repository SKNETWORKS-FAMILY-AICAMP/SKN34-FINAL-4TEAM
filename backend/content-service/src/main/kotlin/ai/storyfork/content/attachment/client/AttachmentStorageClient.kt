package ai.storyfork.content.attachment.client

import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client

class AttachmentStorageClient(private val s3: S3Client, private val bucket: String) {
    fun upload(key: String, payload: AttachmentObjectPayload) = storageCall {
        s3.putObject({ it.bucket(bucket).key(key).contentType(payload.mediaType).contentLength(payload.bytes.size.toLong()) }, RequestBody.fromBytes(payload.bytes))
        Unit
    }

    fun read(key: String): AttachmentObjectResult = storageCall {
        s3.getObject { it.bucket(bucket).key(key) }.use { stream ->
            val bytes = stream.readNBytes(AttachmentUploadHelper.MAX_BYTES + 1)
            if (bytes.size > AttachmentUploadHelper.MAX_BYTES) throw AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소를 확인해 주세요.")
            AttachmentObjectResult(bytes)
        }
    }

    fun delete(key: String) = storageCall { s3.deleteObject { it.bucket(bucket).key(key) }; Unit }

    private fun <T> storageCall(action: () -> T): T = try { action() } catch (e: AttachmentFailure) { throw e } catch (_: Exception) {
        throw AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요.")
    }
}
