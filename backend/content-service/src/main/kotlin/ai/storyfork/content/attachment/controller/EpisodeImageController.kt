package ai.storyfork.content.attachment.controller

import ai.storyfork.content.attachment.helper.ImageDownloadHelper
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.dto.*
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.http.*
import org.springframework.web.bind.annotation.*

/** 회차 본문 이미지 업로드·조회를 바인딩한다. 저장 버전 보존을 위해 이미지 바이트는 불변이다. */
@RestController
class EpisodeImageController(private val service: AttachmentService) {
    /** 소유자의 편집 가능한 실제 회차에 PNG·JPEG를 추가한다. 형식·10개 한도·원작 회차·저장 실패를 검사한다. */
    @PostMapping("/api/v1/works/{work}/episodes/{number}/images", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun create(@PathVariable work: String, @PathVariable number: Int, principal: Principal, @Valid @ModelAttribute request: AttachmentUploadRequest): ResponseEntity<AttachmentResponse> =
        ResponseEntity.status(HttpStatus.CREATED).body(service.createEpisodeImage(work, number, principal.name, request))

    /** 소유자에게 회차 이미지를 반환한다. 원작 기준 회차는 보존된 본문 참조만 조회할 수 있다. */
    @GetMapping("/api/v1/works/{work}/episodes/{number}/images/{id}/content")
    fun download(@PathVariable work: String, @PathVariable number: Int, @PathVariable id: String, principal: Principal) =
        ImageDownloadHelper.response(service.downloadEpisodeImage(work, number, id, principal.name, false))

    /** 현재 공개된 정확한 회차 본문에 참조된 이미지만 반환한다. 초안·다른 회차·추측한 ID는 404다. */
    @GetMapping("/api/v1/public/works/{work}/episodes/{number}/images/{id}/content")
    fun publicDownload(@PathVariable work: String, @PathVariable number: Int, @PathVariable id: String) =
        ImageDownloadHelper.response(service.downloadEpisodeImage(work, number, id, null, true))
}
