package ai.storyfork.core.settingattachment.controller

import ai.storyfork.core.settingattachment.service.SettingAttachmentService
import ai.storyfork.core.settingattachment.service.dto.*
import jakarta.validation.Valid
import java.nio.charset.StandardCharsets
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.*
import org.springframework.web.bind.annotation.*

/** 소유한 로컬 설정의 이미지·일반 첨부 CRUD를 바인딩한다. 권한·저장 판단은 Service에 위임한다. */
@RestController
@RequestMapping("/api/v1/works/{workId}/settings/{settingId}/attachments")
@ConditionalOnProperty(name = ["app.content.enabled", "app.setting-attachments.enabled"], havingValue = "true")
class SettingAttachmentController(private val service: SettingAttachmentService) {
    /** 인증된 소유자의 첨부 목록을 AttachmentListResponse로 반환한다. 타인·following Fork·미존재 설정은 404다. */
    @GetMapping
    fun list(@PathVariable workId: String, @PathVariable settingId: String, principal: Principal): AttachmentListResponse =
        service.list(workId, settingId, principal.name)

    /** multipart AttachmentUploadRequest를 저장하고 AttachmentResponse와 201을 반환한다. 소유권·형식·10개 한도·저장 실패를 검사한다. */
    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun create(@PathVariable workId: String, @PathVariable settingId: String, principal: Principal, @Valid @ModelAttribute request: AttachmentUploadRequest): ResponseEntity<AttachmentResponse> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(workId, settingId, principal.name, request))

    /** 인증된 소유자의 첨부 메타데이터를 AttachmentResponse로 반환한다. 다른 설정의 ID와 미존재 리소스는 404다. */
    @GetMapping("/{attachmentId}")
    fun read(@PathVariable workId: String, @PathVariable settingId: String, @PathVariable attachmentId: String, principal: Principal): AttachmentResponse =
        service.read(workId, settingId, attachmentId, principal.name)

    /** 권한을 재검사하고 AttachmentDownloadResult의 바이트를 attachment·nosniff로 전달한다. 미존재·저장소 실패는 성공으로 숨기지 않는다. */
    @GetMapping("/{attachmentId}/content")
    fun download(@PathVariable workId: String, @PathVariable settingId: String, @PathVariable attachmentId: String, principal: Principal): ResponseEntity<ByteArray> {
        val result = service.download(workId, settingId, attachmentId, principal.name)
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(result.attachment.mediaType))
            .contentLength(result.attachment.byteSize)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(result.attachment.filename, StandardCharsets.UTF_8).build().toString())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header("X-Content-Type-Options", "nosniff").body(result.bytes)
    }

    /** 소유자의 AttachmentUploadRequest로 기존 첨부를 교체하고 AttachmentResponse를 반환한다. 잘못된 파일·한도·저장 실패 시 오류를 반환한다. */
    @PutMapping("/{attachmentId}", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun replace(@PathVariable workId: String, @PathVariable settingId: String, @PathVariable attachmentId: String, principal: Principal, @Valid @ModelAttribute request: AttachmentUploadRequest): AttachmentResponse =
        service.replace(workId, settingId, attachmentId, principal.name, request)

    /** 인증된 소유자의 첨부를 삭제하고 204를 반환한다. 타인·미존재 리소스와 DB·저장소 실패를 구분한다. */
    @DeleteMapping("/{attachmentId}")
    fun delete(@PathVariable workId: String, @PathVariable settingId: String, @PathVariable attachmentId: String, principal: Principal): ResponseEntity<Void> {
        service.delete(workId, settingId, attachmentId, principal.name)
        return ResponseEntity.noContent().build()
    }
}
