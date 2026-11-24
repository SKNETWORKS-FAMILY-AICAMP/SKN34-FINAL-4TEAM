package ai.storyfork.content.attachment.controller

import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import ai.storyfork.content.attachment.service.CardAttachmentService
import ai.storyfork.content.attachment.service.dto.*
import jakarta.validation.Valid
import java.nio.charset.StandardCharsets
import java.security.Principal
import org.springframework.http.*
import org.springframework.web.bind.annotation.*

/** 세계관 스튜디오 설정 카드의 이미지·일반 첨부 CRUD를 바인딩한다(#735). 옛 설정 첨부([SettingAttachmentController])와 같은 모양이고 권한·저장 판단은 Service에 위임한다. */
@RestController
@RequestMapping("/api/v1/world-studios/{worldId}/cards/{cardId}/attachments")
class CardAttachmentController(private val service: CardAttachmentService) {
    @GetMapping
    fun list(@PathVariable worldId: String, @PathVariable cardId: String, principal: Principal): AttachmentListResponse =
        service.list(worldId, cardId, principal.name)

    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun create(@PathVariable worldId: String, @PathVariable cardId: String, principal: Principal, @Valid @ModelAttribute request: AttachmentUploadRequest): ResponseEntity<AttachmentResponse> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.create(worldId, cardId, principal.name, checked(worldId, cardId, principal, request)))

    @GetMapping("/{attachmentId}")
    fun read(@PathVariable worldId: String, @PathVariable cardId: String, @PathVariable attachmentId: String, principal: Principal): AttachmentResponse =
        service.read(worldId, cardId, attachmentId, principal.name)

    @GetMapping("/{attachmentId}/content")
    fun download(@PathVariable worldId: String, @PathVariable cardId: String, @PathVariable attachmentId: String, principal: Principal): ResponseEntity<ByteArray> {
        val result = service.download(worldId, cardId, attachmentId, principal.name)
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(result.attachment.mediaType))
            .contentLength(result.attachment.byteSize)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(result.attachment.filename, StandardCharsets.UTF_8).build().toString())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header("X-Content-Type-Options", "nosniff").body(result.bytes)
    }

    @PutMapping("/{attachmentId}", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun replace(@PathVariable worldId: String, @PathVariable cardId: String, @PathVariable attachmentId: String, principal: Principal, @Valid @ModelAttribute request: AttachmentUploadRequest): AttachmentResponse =
        service.replace(worldId, cardId, attachmentId, principal.name, checked(worldId, cardId, principal, request))

    @PatchMapping("/{attachmentId}")
    fun rename(@PathVariable worldId: String, @PathVariable cardId: String, @PathVariable attachmentId: String, principal: Principal, @RequestBody request: AttachmentRenameRequest): AttachmentResponse =
        service.rename(worldId, cardId, attachmentId, principal.name, request)

    @DeleteMapping("/{attachmentId}")
    fun delete(@PathVariable worldId: String, @PathVariable cardId: String, @PathVariable attachmentId: String, principal: Principal): ResponseEntity<Void> {
        service.delete(worldId, cardId, attachmentId, principal.name)
        return ResponseEntity.noContent().build()
    }

    /** 카드 접근을 먼저 확인한 뒤 업로드 파일을 읽고 검증한다. 파일 처리는 DB 잠금 밖에서 끝난다. */
    private fun checked(worldId: String, cardId: String, principal: Principal, request: AttachmentUploadRequest): AttachmentUploadPayload {
        service.requireUploadAccess(worldId, cardId, principal.name)
        return AttachmentUploadHelper.validate(request.file)
    }
}
