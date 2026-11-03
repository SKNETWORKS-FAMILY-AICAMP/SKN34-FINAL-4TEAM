package ai.storyfork.core.settingattachment.service

import ai.storyfork.core.settingattachment.client.AttachmentStorageClient
import ai.storyfork.core.settingattachment.client.dto.AttachmentObjectPayload
import ai.storyfork.core.settingattachment.domain.AttachmentFailure
import ai.storyfork.core.settingattachment.entity.SettingAttachment
import ai.storyfork.core.settingattachment.helper.AttachmentUploadHelper
import ai.storyfork.core.settingattachment.repository.AttachmentSettingRepository
import ai.storyfork.core.settingattachment.repository.SettingAttachmentRepository
import ai.storyfork.core.settingattachment.service.dto.*
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.dao.DataAccessException
import org.springframework.stereotype.Service
import org.springframework.transaction.TransactionException
import org.springframework.transaction.support.TransactionTemplate

@Service
@ConditionalOnProperty(name = ["app.content.enabled", "app.setting-attachments.enabled"], havingValue = "true")
class SettingAttachmentService(
    private val settings: AttachmentSettingRepository,
    private val attachments: SettingAttachmentRepository,
    private val storage: AttachmentStorageClient,
    @Qualifier("attachmentTransactions") private val transactions: TransactionTemplate,
) {
    private fun missing(): Nothing = throw AttachmentFailure(404, "ATTACHMENT_NOT_FOUND", "설정 또는 첨부를 찾을 수 없어요.")
    private fun owned(workId: String, settingId: String, owner: String): String {
        if (owner.isBlank() || owner.length > 200) throw AttachmentFailure(401, "ATTACHMENT_UNAUTHENTICATED", "인증이 필요해요.")
        return settings.lockOwnedLocal(workId, settingId, owner)?.id ?: missing()
    }
    private fun find(id: String, documentId: String) = attachments.findByIdAndSettingDocumentId(id, documentId) ?: missing()
    private fun response(a: SettingAttachment, work: String, setting: String) = AttachmentResponse(a.id, a.filename, a.mediaType, a.kind, a.byteSize, a.createdAt,
        "/api/v1/works/$work/settings/$setting/attachments/${a.id}/content")
    private fun limit(document: String, kind: String, previousKind: String? = null) {
        if (kind == "IMAGE" && previousKind != "IMAGE" && attachments.countBySettingDocumentIdAndKind(document, "IMAGE") >= 10)
            throw AttachmentFailure(409, "ATTACHMENT_IMAGE_LIMIT", "설정 이미지는 최대 10개까지 추가할 수 있어요.")
    }
    private fun <T : Any> transaction(action: () -> T): T = try {
        requireNotNull(transactions.execute { action() })
    } catch (_: DataAccessException) {
        throw AttachmentFailure(503, "ATTACHMENT_DATABASE_FAILURE", "첨부 정보를 저장하거나 조회하지 못했어요.")
    } catch (_: TransactionException) {
        throw AttachmentFailure(503, "ATTACHMENT_DATABASE_FAILURE", "첨부 정보를 저장하거나 조회하지 못했어요.")
    }

    // ponytail: same-setting reads/writes serialize through S3 I/O; split read locking only if measured contention warrants it.
    fun list(work: String, setting: String, owner: String) = transaction {
        val document = owned(work, setting, owner)
        AttachmentListResponse(attachments.findAllBySettingDocumentIdOrderByCreatedAtAscIdAsc(document).map { response(it, work, setting) })
    }
    fun read(work: String, setting: String, id: String, owner: String) = transaction {
        response(find(id, owned(work, setting, owner)), work, setting)
    }
    fun download(work: String, setting: String, id: String, owner: String) = transaction {
        val attachment = find(id, owned(work, setting, owner))
        val bytes = readObject(attachment).bytes
        AttachmentDownloadResult(response(attachment, work, setting), bytes)
    }
    fun create(work: String, setting: String, owner: String, request: AttachmentUploadRequest) = transaction {
        val document = owned(work, setting, owner)
        val payload = AttachmentUploadHelper.validate(request)
        limit(document, payload.kind)
        val key = "setting-attachments/${UUID.randomUUID()}"
        storage.upload(key, AttachmentObjectPayload(payload.bytes, payload.mediaType))
        val attachment = attachments.saveAndFlush(SettingAttachment(settingDocumentId=document, objectKey=key, filename=payload.filename,
            mediaType=payload.mediaType, kind=payload.kind, byteSize=payload.bytes.size.toLong()))
        response(attachment, work, setting)
    }
    fun replace(work: String, setting: String, id: String, owner: String, request: AttachmentUploadRequest): AttachmentResponse {
        var previousKey: String? = null
        var backup: AttachmentObjectPayload? = null
        try {
            return transaction {
                val document = owned(work, setting, owner)
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
    fun delete(work: String, setting: String, id: String, owner: String) {
        var previousKey: String? = null
        var backup: AttachmentObjectPayload? = null
        try {
            transaction {
                val attachment = find(id, owned(work, setting, owner))
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
}
