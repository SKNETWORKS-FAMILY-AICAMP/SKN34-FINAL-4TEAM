package ai.storyfork.content.imagegeneration.controller
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.imagegeneration.service.ImageJobService
import ai.storyfork.content.imagegeneration.service.dto.*
import ai.storyfork.content.world.domain.WORLD_COVER_MAX_BYTES
import jakarta.validation.Valid
import java.security.Principal
import java.util.UUID
import org.springframework.http.*
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile

/** 인증된 소유자의 이미지 접수·조회·미리보기. 적용·발행은 기존 대상 API가 담당한다. */
@RestController
@RequestMapping("/api/v1/image-generations")
class ImageJobController(private val service:ImageJobService) {
 @PostMapping
 fun submit(principal:Principal,@RequestHeader("Idempotency-Key") key:UUID,@Valid @RequestBody request:ImageRequest)=
  ResponseEntity.status(202).body(service.submit(principal.name,key,request))
 @PostMapping("/with-reference", consumes=[MediaType.MULTIPART_FORM_DATA_VALUE])
 fun submitUpload(principal:Principal,@RequestHeader("Idempotency-Key") key:UUID,
                  @Valid @RequestPart("request") request:ImageRequest,@RequestPart("file") file:MultipartFile):ResponseEntity<ImageResult> {
  if(file.size>WORLD_COVER_MAX_BYTES) throw ContentFailure(422,"참고 이미지는 5 MiB 이하로 올려 주세요.")
  val bytes=file.inputStream.use { it.readNBytes(WORLD_COVER_MAX_BYTES+1) }
  return ResponseEntity.status(202).body(service.submit(principal.name,key,request,bytes))
 }
 @GetMapping("/by-request/{key}") fun byKey(@PathVariable key:UUID,principal:Principal)=service.byKey(key,principal.name)
 @GetMapping("/{id}") fun read(@PathVariable id:UUID,principal:Principal)=service.read(id,principal.name)
 @GetMapping("/{id}/content") fun content(@PathVariable id:UUID,principal:Principal)=ResponseEntity.ok()
  .contentType(MediaType.IMAGE_PNG).header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff")
  .body(service.content(id,principal.name))
 @DeleteMapping("/{id}") fun delete(@PathVariable id:UUID,principal:Principal):ResponseEntity<Void> {
  service.delete(id,principal.name);return ResponseEntity.noContent().build()
 }
}
/** 기존 내부 서비스 토큰 체인 아래에서 jobId에 한정해 실행 상태를 전달한다. */
@RestController
@RequestMapping("/internal/v1/ai/image-generations/{id}")
class ImageJobInternalController(private val service:ImageJobService) {
 @PostMapping("/claim") fun claim(@PathVariable id:UUID)=service.claim(id)
 @GetMapping("/reference") fun reference(@PathVariable id:UUID)=service.reference(id).let {
  ResponseEntity.ok().contentType(MediaType.parseMediaType(it.mediaType))
   .header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").body(it.bytes)
 }
 @PostMapping("/progress") fun progress(@PathVariable id:UUID,@RequestBody r:ImageProgress)=service.progress(id,r.stage)
 @PostMapping("/failed") fun failed(@PathVariable id:UUID,@RequestBody r:ImageProgress)=service.failed(id,r.stage)
 @PostMapping("/interrupted") fun interrupted(@PathVariable id:UUID,@RequestBody r:ImageProgress)=service.failed(id,r.stage,true)
 @PostMapping("/complete") fun complete(@PathVariable id:UUID,@RequestBody r:ImageCompletion)=service.complete(id,r.key)
}

/** 공개하는 범위는 서버에 내장된 기본 참조 원화뿐이다. */
@RestController
class CoverReferenceController(private val service:ImageJobService) {
 @GetMapping("/api/v1/public/cover-references/{version}")
 fun preset(@PathVariable version:String)=service.preset(version).let {
  ResponseEntity.ok().contentType(MediaType.parseMediaType(it.mediaType))
   .header("Cache-Control","public, max-age=31536000, immutable").header("X-Content-Type-Options","nosniff").body(it.bytes)
 }
}
