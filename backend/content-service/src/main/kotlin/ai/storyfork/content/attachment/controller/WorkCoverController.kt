package ai.storyfork.content.attachment.controller

import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import ai.storyfork.content.attachment.helper.ImageDownloadHelper
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.dto.*
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.http.*
import org.springframework.web.bind.annotation.*

/** 작품 표지 CRUD를 바인딩한다. 소유권·기존 작품 공개 범위와 저장 판단은 Service가 검사한다. */
@RestController
class WorkCoverController(private val service: AttachmentService) {
    /** 소유자에게 현재 표지 메타데이터를 반환한다. 타인·미존재 표지는 404다. */
    @GetMapping("/api/v1/works/{work}/cover")
    fun read(@PathVariable work: String, principal: Principal) = service.readCover(work, principal.name)

    /** 인증된 소유자의 PNG·JPEG multipart를 저장·교체한다. 검증·저장 실패 시 이전 참조를 보존한다. */
    @PutMapping("/api/v1/works/{work}/cover", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun put(@PathVariable work: String, principal: Principal, @Valid @ModelAttribute request: AttachmentUploadRequest) = service.putCover(work, principal.name, checked(work, principal, request))

    /** 소유자의 현재 표지 참조를 삭제한다. 타인·미존재 표지는 404다. */
    @DeleteMapping("/api/v1/works/{work}/cover")
    fun delete(@PathVariable work: String, principal: Principal): ResponseEntity<Void> { service.deleteCover(work, principal.name); return ResponseEntity.noContent().build() }

    /** 인증된 소유자에게 표지 바이트를 no-store·nosniff로 반환한다. 저장소 실패는 503이다. */
    @GetMapping("/api/v1/works/{work}/cover/content")
    fun download(@PathVariable work: String, principal: Principal) = ImageDownloadHelper.response(service.downloadCover(work, principal.name, false))

    /** 기존 공개 작품에 한해 현재 표지를 반환한다. 미공개 작품·미존재 표지는 404다. */
    @GetMapping("/api/v1/public/works/{work}/cover/content")
    fun publicDownload(@PathVariable work: String) = ImageDownloadHelper.response(service.downloadCover(work, null, true))

    /** 소유 작품인지 짧은 잠금 트랜잭션으로 먼저 확인한 뒤 업로드 파일을 읽고 검증한다. 파일 처리는 DB 잠금 밖에서 끝난다. */
    private fun checked(work: String, principal: Principal, request: AttachmentUploadRequest): AttachmentUploadPayload {
        service.requireWorkUploadAccess(work, principal.name)
        return AttachmentUploadHelper.validate(request.file)
    }
}
