package ai.storyfork.content.manuscript.controller

import ai.storyfork.content.manuscript.service.ManuscriptExportService
import ai.storyfork.content.manuscript.service.ManuscriptImportService
import ai.storyfork.content.manuscript.service.dto.ManuscriptImportRequest
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.Principal
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile

/** 소유한 작품의 원고 가져오기(미리보기·확정)와 내보내기를 바인딩한다. 권한·검증·저장은 Service에 위임하고 오류는 `{detail}`로 돌려준다. */
@RestController
@RequestMapping("/api/v1/works/{workId}")
class ManuscriptController(private val imports: ManuscriptImportService, private val exports: ManuscriptExportService) {
    /** multipart `file`(.txt·.epub)을 저장 없이 읽어 회차 후보를 반환한다. 형식·DRM·인코딩·읽기 실패와 300회차 초과는 422, 한도 초과는 413이다. */
    @PostMapping("/manuscript-imports/preview", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun preview(@PathVariable workId: String, principal: Principal, @RequestPart("file", required = false) file: MultipartFile?) =
        imports.preview(workId, principal.name, file)

    /** 같은 파일(`file`)과 조정한 범위(JSON part `request`)로 회차를 저장하고 회차별 결과를 반환한다. 일부가 실패해도 200이고 요청 검증 실패는 422다. */
    @PostMapping("/manuscript-imports", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun confirm(@PathVariable workId: String, principal: Principal, @RequestPart("file", required = false) file: MultipartFile?, @RequestPart("request", required = false) request: ManuscriptImportRequest?) =
        imports.confirm(workId, principal.name, file, request)

    /** 소유자의 초안·발행본을 TXT·EPUB 첨부 파일로 내려 준다. 잘못된 형식은 422, 상속 회차 단독 내보내기는 403이다. */
    @GetMapping("/manuscript-export")
    fun export(@PathVariable workId: String, principal: Principal, @RequestParam(required = false) format: String?, @RequestParam(required = false) source: String?, @RequestParam(required = false) episode: Int?): ResponseEntity<ByteArray> {
        val result = exports.export(workId, principal.name, format, source, episode)
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(result.contentType)).contentLength(result.bytes.size.toLong())
            // 계약대로 filename*만 쓴다(Spring의 ContentDisposition은 ASCII 대체 filename=도 함께 내보낸다). 퍼센트 인코딩이라 헤더 주입이 불가능하다.
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(result.filename, StandardCharsets.UTF_8).replace("+", "%20"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store").header("X-Content-Type-Options", "nosniff").body(result.bytes)
    }
}
