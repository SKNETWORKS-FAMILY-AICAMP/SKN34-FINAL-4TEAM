package ai.storyfork.content.attachment.client

import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.CreateBucketRequest
import software.amazon.awssdk.services.s3.model.HeadBucketRequest
import software.amazon.awssdk.services.s3.model.NoSuchBucketException

class AttachmentStorageClient(private val s3: S3Client, private val bucket: String) {
    /** local·dev MinIO용: 버킷이 없으면 시작 시 한 번 만든다. 다른 오류는 그대로 던져 기동을 멈춘다. */
    fun ensureBucket() {
        try { s3.headBucket(HeadBucketRequest.builder().bucket(bucket).build()) }
        catch (_: NoSuchBucketException) { s3.createBucket(CreateBucketRequest.builder().bucket(bucket).build()) }
    }

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
