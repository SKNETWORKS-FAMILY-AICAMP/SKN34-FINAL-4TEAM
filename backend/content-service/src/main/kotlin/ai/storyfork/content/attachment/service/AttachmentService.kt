package ai.storyfork.content.attachment.service

import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.entity.ContentImage
import ai.storyfork.content.attachment.entity.SettingAttachment
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import ai.storyfork.content.attachment.repository.AttachmentSettingRepository
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.attachment.repository.ImageWorkRepository
import ai.storyfork.content.attachment.repository.SettingAttachmentRepository
import ai.storyfork.content.attachment.service.dto.*
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.episode.service.EpisodeService
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataAccessException
import org.springframework.stereotype.Service
import org.springframework.transaction.TransactionException
import org.springframework.transaction.support.TransactionTemplate

@Service
class AttachmentService(
    private val settings: AttachmentSettingRepository,
    private val attachments: SettingAttachmentRepository,
    private val images: ContentImageRepository,
    private val works: ImageWorkRepository,
    private val content: WorkService,
    private val episodeService: EpisodeService,
    private val storage: AttachmentStorageClient,
    @Qualifier("attachmentTransactions") private val transactions: TransactionTemplate,
    private val imageEpisodes: ai.storyfork.content.attachment.repository.ImageEpisodeRepository,
) {
    private fun missingSettingAttachment(): Nothing = throw AttachmentFailure(404, "ATTACHMENT_NOT_FOUND", "설정 또는 첨부를 찾을 수 없어요.")
    private fun ownedSetting(workId: String, settingId: String, owner: String): String {
        if (owner.isBlank() || owner.length > 200) throw AttachmentFailure(401, "ATTACHMENT_UNAUTHENTICATED", "인증이 필요해요.")
        return settings.lockOwnedLocal(workId, settingId, owner)?.id ?: missingSettingAttachment()
    }
    private fun find(id: String, documentId: String) = attachments.findByIdAndSettingDocumentId(id, documentId) ?: missingSettingAttachment()
    private fun response(a: SettingAttachment, work: String, setting: String) = AttachmentResponse(a.id, a.filename, a.mediaType, a.kind, a.byteSize, a.createdAt,
        "/api/v1/works/$work/settings/$setting/attachments/${a.id}/content")
    private fun limit(document: String, kind: String, previousKind: String? = null) {
        if (kind == "IMAGE" && previousKind != "IMAGE" && attachments.countBySettingDocumentIdAndKind(document, "IMAGE") >= 10)
            throw AttachmentFailure(409, "ATTACHMENT_IMAGE_LIMIT", "설정 이미지는 최대 10개까지 추가할 수 있어요.")
    }
    private fun <T : Any> settingTransaction(action: () -> T): T = try {
        requireNotNull(transactions.execute { action() })
    } catch (_: DataAccessException) {
        throw AttachmentFailure(503, "ATTACHMENT_DATABASE_FAILURE", "첨부 정보를 저장하거나 조회하지 못했어요.")
    } catch (_: TransactionException) {
        throw AttachmentFailure(503, "ATTACHMENT_DATABASE_FAILURE", "첨부 정보를 저장하거나 조회하지 못했어요.")
    }

    // ponytail: same-setting reads/writes serialize through S3 I/O; split read locking only if measured contention warrants it.
    fun listSettingAttachments(work: String, setting: String, owner: String) = settingTransaction {
        val document = ownedSetting(work, setting, owner)
        AttachmentListResponse(attachments.findAllBySettingDocumentIdOrderByCreatedAtAscIdAsc(document).map { response(it, work, setting) })
    }
    fun readSettingAttachment(work: String, setting: String, id: String, owner: String) = settingTransaction {
        response(find(id, ownedSetting(work, setting, owner)), work, setting)
    }
    fun downloadSettingAttachment(work: String, setting: String, id: String, owner: String) = settingTransaction {
        val attachment = find(id, ownedSetting(work, setting, owner))
        val bytes = readObject(attachment).bytes
        AttachmentDownloadResult(response(attachment, work, setting), bytes)
    }
    fun createSettingAttachment(work: String, setting: String, owner: String, request: AttachmentUploadRequest) = settingTransaction {
        val document = ownedSetting(work, setting, owner)
        val payload = AttachmentUploadHelper.validate(request)
        limit(document, payload.kind)
        val key = "setting-attachments/${UUID.randomUUID()}"
        storage.upload(key, AttachmentObjectPayload(payload.bytes, payload.mediaType))
        val attachment = attachments.saveAndFlush(SettingAttachment(settingDocumentId=document, objectKey=key, filename=payload.filename,
            mediaType=payload.mediaType, kind=payload.kind, byteSize=payload.bytes.size.toLong()))
        response(attachment, work, setting)
    }
    fun replaceSettingAttachment(work: String, setting: String, id: String, owner: String, request: AttachmentUploadRequest): AttachmentResponse {
        var previousKey: String? = null
        var backup: AttachmentObjectPayload? = null
        try {
            return settingTransaction {
                val document = ownedSetting(work, setting, owner)
                val attachment = find(id, document)
                val payload = AttachmentUploadHelper.validate(request)
                limit(document, payload.kind, attachment.kind)
                val oldKey = attachment.objectKey
                val oldObject = readObject(attachment)
                val key = "setting-attachments/${UUID.randomUUID()}"
                storage.upload(key, AttachmentObjectPayload(payload.bytes, payload.mediaType))
                attachment.objectKey=key; attachment.filename=payload.filename; attachment.mediaType=payload.mediaType
                attachment.kind=payload.kind; attachment.byteSize=payload.bytes.size.toLong()
                attachments.saveAndFlush(attachment)
                previousKey=oldKey; backup=oldObject
                storage.delete(oldKey)
                response(attachment, work, setting)
            }
        } catch (e: RuntimeException) { restore(previousKey, backup); throw e }
    }
    fun deleteSettingAttachment(work: String, setting: String, id: String, owner: String) {
        var previousKey: String? = null
        var backup: AttachmentObjectPayload? = null
        try {
            settingTransaction {
                val attachment = find(id, ownedSetting(work, setting, owner))
                val oldObject = readObject(attachment)
                attachments.delete(attachment); attachments.flush()
                previousKey=attachment.objectKey; backup=oldObject
                storage.delete(attachment.objectKey)
            }
        } catch (e: RuntimeException) { restore(previousKey, backup); throw e }
    }
    private fun readObject(attachment: SettingAttachment): AttachmentObjectPayload {
        val bytes = storage.read(attachment.objectKey).bytes
        if (bytes.size.toLong() != attachment.byteSize) throw AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 파일의 저장 상태를 확인해 주세요.")
        return AttachmentObjectPayload(bytes, attachment.mediaType)
    }
    private fun restore(key: String?, backup: AttachmentObjectPayload?) {
        if (key == null || backup == null) return
        // ponytail: bounded in-memory compensation, not distributed atomicity; process loss or a failed restore requires operator reconciliation.
        // Keep the new unique object on an ambiguous DB outcome so neither possible committed reference is destroyed.
        try { storage.upload(key, backup) } catch (_: RuntimeException) {
            throw AttachmentFailure(503, "ATTACHMENT_RECOVERY_REQUIRED", "첨부 복구를 완료하지 못했어요. 재시도 전에 운영자 확인이 필요해요.")
        }
    }

    private fun missingImage(): Nothing = throw AttachmentFailure(404, "IMAGE_NOT_FOUND", "이미지를 찾을 수 없어요.")
    private fun <T : Any> imageTransaction(action: () -> T): T = try { requireNotNull(transactions.execute { action() }) }
    catch (_: DataAccessException) { throw AttachmentFailure(503, "IMAGE_DATABASE_FAILURE", "이미지 정보를 저장하거나 조회하지 못했어요.") }
    catch (_: TransactionException) { throw AttachmentFailure(503, "IMAGE_DATABASE_FAILURE", "이미지 정보를 저장하거나 조회하지 못했어요.") }
    private fun ownedWork(work: String, owner: String) {
        if (owner.isBlank()) throw AttachmentFailure(401, "IMAGE_UNAUTHENTICATED", "인증이 필요해요.")
        works.lockOwned(work, owner) ?: missingImage()
    }
    private fun cover(work: String) = images.findByWorkIdAndEpisodeNo(work, 0).singleOrNull() ?: missingImage()
    private fun response(image: ContentImage, work: String = image.workId) = AttachmentResponse(image.id, image.filename, image.mediaType, "IMAGE", image.byteSize, image.createdAt,
        if (image.episodeNo == 0) "/api/v1/works/$work/cover/content" else "/api/v1/works/$work/episodes/${image.episodeNo}/images/${image.id}/content")
    private fun imageBytes(image: ContentImage): ByteArray = storage.read(image.objectKey).bytes.also {
        if (it.size.toLong() != image.byteSize) throw AttachmentFailure(503, "IMAGE_STORAGE_FAILURE", "이미지 저장 상태를 확인해 주세요.")
    }
    private fun imagePayload(request: AttachmentUploadRequest) = AttachmentUploadHelper.validate(request).also {
        if (it.kind != "IMAGE") throw AttachmentFailure(422, "IMAGE_INVALID", "표지와 본문에는 PNG 또는 JPEG 이미지만 사용할 수 있어요.")
    }
    fun readCover(work: String, owner: String) = imageTransaction { ownedWork(work, owner); response(cover(work)) }
    fun downloadCover(work: String, owner: String?, public: Boolean): AttachmentDownloadResult {
        if (public) content.publicRead(work)
        return imageTransaction { if (!public) ownedWork(work, owner ?: ""); val image = cover(work); AttachmentDownloadResult(response(image), imageBytes(image)) }
    }
    fun putCover(work: String, owner: String, request: AttachmentUploadRequest) = imageTransaction {
        ownedWork(work, owner)
        val data = imagePayload(request)
        val previous = images.findByWorkIdAndEpisodeNo(work, 0).singleOrNull()
        val key = "work-covers/${UUID.randomUUID()}"
        storage.upload(key, AttachmentObjectPayload(data.bytes, data.mediaType))
        val image = previous ?: ContentImage(workId = work)
        image.objectKey = key; image.filename = data.filename; image.mediaType = data.mediaType; image.byteSize = data.bytes.size.toLong()
        images.saveAndFlush(image)
        // ponytail: retain superseded objects instead of risking loss on an ambiguous DB commit; lifecycle reconciliation is operator-owned.
        response(image)
    }
    fun deleteCover(work: String, owner: String) { imageTransaction { ownedWork(work, owner); images.delete(cover(work)); images.flush(); true } }
    fun createEpisodeImage(work: String, number: Int, owner: String, request: AttachmentUploadRequest): AttachmentResponse {
        val episode = episodeService.read(work, owner, number)
        if (episode.inherited) throw AttachmentFailure(403, "IMAGE_INHERITED", "원작 기준 회차에는 이미지를 추가할 수 없어요.")
        return imageTransaction {
            ownedWork(work, owner)
            // The attachment work lock and Core deletion lock target the same database row.
            // Recheck after locking: deletion may have committed since the initial Core read.
            if (!imageEpisodes.existsByWorkIdAndSequence(work, number)) missingImage()
            val data = imagePayload(request)
            if (images.countByWorkIdAndEpisodeNo(work, number) >= 10) throw AttachmentFailure(409, "IMAGE_LIMIT", "회차 이미지는 최대 10개까지 추가할 수 있어요.")
            val key = "episode-images/${UUID.randomUUID()}"
            storage.upload(key, AttachmentObjectPayload(data.bytes, data.mediaType))
            response(images.saveAndFlush(ContentImage(workId = work, episodeNo = number, objectKey = key, filename = data.filename, mediaType = data.mediaType, byteSize = data.bytes.size.toLong())))
        }
    }
    fun downloadEpisodeImage(work: String, number: Int, id: String, owner: String?, public: Boolean): AttachmentDownloadResult {
        val marker = "[[image:$id]]"
        // Public access is granted by the exact existing published body, never by a guessed image ID or a draft.
        val referenced = if (public) {
            content.publicRead(work).episodes.any { it.number == number && marker in it.body }
        } else {
            val episode = episodeService.read(work, owner ?: "", number)
            episode.inherited && marker in episode.draft.body
        }
        if (public && !referenced) missingImage()
        return imageTransaction {
            val image = images.findById(id).orElse(null) ?: missingImage()
            if (!episodeService.permitsImageReference(work, number, image) || (image.workId != work && !referenced)) missingImage()
            AttachmentDownloadResult(response(image, work), imageBytes(image))
        }
    }
}
