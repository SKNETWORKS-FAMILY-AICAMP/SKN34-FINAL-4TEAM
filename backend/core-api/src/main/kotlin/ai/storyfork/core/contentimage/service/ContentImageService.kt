package ai.storyfork.core.contentimage.service

import ai.storyfork.core.content.service.ContentService
import ai.storyfork.core.contentimage.entity.ContentImage
import ai.storyfork.core.contentimage.repository.ContentImageRepository
import ai.storyfork.core.contentimage.repository.ImageWorkRepository
import ai.storyfork.core.settingattachment.client.AttachmentStorageClient
import ai.storyfork.core.settingattachment.client.dto.AttachmentObjectPayload
import ai.storyfork.core.settingattachment.domain.AttachmentFailure
import ai.storyfork.core.settingattachment.helper.AttachmentUploadHelper
import ai.storyfork.core.settingattachment.service.dto.*
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.dao.DataAccessException
import org.springframework.stereotype.Service
import org.springframework.transaction.TransactionException
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

@Service
@ConditionalOnProperty(name = ["app.content.enabled", "app.setting-attachments.enabled"], havingValue = "true")
class ContentImageService(
    private val images: ContentImageRepository,
    private val works: ImageWorkRepository,
    private val content: ContentService,
    private val storage: AttachmentStorageClient,
    @Qualifier("attachmentTransactions") private val transactions: TransactionTemplate,
) {
    private fun missing(): Nothing = throw AttachmentFailure(404, "IMAGE_NOT_FOUND", "이미지를 찾을 수 없어요.")
    private fun <T : Any> transaction(action: () -> T): T = try { requireNotNull(transactions.execute { action() }) }
    catch (_: DataAccessException) { throw AttachmentFailure(503, "IMAGE_DATABASE_FAILURE", "이미지 정보를 저장하거나 조회하지 못했어요.") }
    catch (_: TransactionException) { throw AttachmentFailure(503, "IMAGE_DATABASE_FAILURE", "이미지 정보를 저장하거나 조회하지 못했어요.") }
    private fun owned(work: String, owner: String) {
        if (owner.isBlank()) throw AttachmentFailure(401, "IMAGE_UNAUTHENTICATED", "인증이 필요해요.")
        works.lockOwned(work, owner) ?: missing()
    }
    private fun cover(work: String) = images.findByWorkIdAndEpisodeNo(work, 0).singleOrNull() ?: missing()
    private fun response(image: ContentImage, work: String = image.workId) = AttachmentResponse(image.id, image.filename, image.mediaType, "IMAGE", image.byteSize, image.createdAt,
        if (image.episodeNo == 0) "/api/v1/works/$work/cover/content" else "/api/v1/works/$work/episodes/${image.episodeNo}/images/${image.id}/content")
    private fun bytes(image: ContentImage): ByteArray = storage.read(image.objectKey).bytes.also {
        if (it.size.toLong() != image.byteSize) throw AttachmentFailure(503, "IMAGE_STORAGE_FAILURE", "이미지 저장 상태를 확인해 주세요.")
    }
    private fun payload(request: AttachmentUploadRequest) = AttachmentUploadHelper.validate(request).also {
        if (it.kind != "IMAGE") throw AttachmentFailure(422, "IMAGE_INVALID", "표지와 본문에는 PNG 또는 JPEG 이미지만 사용할 수 있어요.")
    }
    fun readCover(work: String, owner: String) = transaction { owned(work, owner); response(cover(work)) }
    fun downloadCover(work: String, owner: String?, public: Boolean): AttachmentDownloadResult {
        if (public) content.publicRead(work)
        return transaction { if (!public) owned(work, owner ?: ""); val image = cover(work); AttachmentDownloadResult(response(image), bytes(image)) }
    }
    fun putCover(work: String, owner: String, request: AttachmentUploadRequest) = transaction {
        owned(work, owner)
        val data = payload(request)
        val previous = images.findByWorkIdAndEpisodeNo(work, 0).singleOrNull()
        val key = "work-covers/${UUID.randomUUID()}"
        storage.upload(key, AttachmentObjectPayload(data.bytes, data.mediaType))
        val image = previous ?: ContentImage(workId = work)
        image.objectKey = key; image.filename = data.filename; image.mediaType = data.mediaType; image.byteSize = data.bytes.size.toLong()
        images.saveAndFlush(image)
        // ponytail: retain superseded objects instead of risking loss on an ambiguous DB commit; lifecycle reconciliation is operator-owned.
        response(image)
    }
    fun deleteCover(work: String, owner: String) { transaction { owned(work, owner); images.delete(cover(work)); images.flush(); true } }
    fun createEpisodeImage(work: String, number: Int, owner: String, request: AttachmentUploadRequest): AttachmentResponse {
        val episode = content.writing(work, owner, number)
        if (episode.inherited) throw AttachmentFailure(403, "IMAGE_INHERITED", "원작 기준 회차에는 이미지를 추가할 수 없어요.")
        return transaction {
            owned(work, owner)
            val data = payload(request)
            if (images.countByWorkIdAndEpisodeNo(work, number) >= 10) throw AttachmentFailure(409, "IMAGE_LIMIT", "회차 이미지는 최대 10개까지 추가할 수 있어요.")
            val key = "episode-images/${UUID.randomUUID()}"
            storage.upload(key, AttachmentObjectPayload(data.bytes, data.mediaType))
            response(images.saveAndFlush(ContentImage(workId = work, episodeNo = number, objectKey = key, filename = data.filename, mediaType = data.mediaType, byteSize = data.bytes.size.toLong())))
        }
    }
    fun downloadEpisodeImage(work: String, number: Int, id: String, owner: String?, public: Boolean): AttachmentDownloadResult {
        val marker = "[[image:$id]]"
        // Public access is granted by the exact existing published body, never by a guessed image ID or a draft.
        if (public) {
            if (content.publicRead(work).episodes.none { it.number == number && marker in it.body }) missing()
        } else {
            val episode = content.writing(work, owner ?: "", number)
            val image = transaction { images.findById(id).orElse(null) ?: missing() }
            if (image.workId != work || image.episodeNo != number) {
                if (!episode.inherited || marker !in episode.draft.body) missing()
            }
        }
        return transaction {
            val image = images.findById(id).orElse(null) ?: missing()
            AttachmentDownloadResult(response(image, work), bytes(image))
        }
    }
}
