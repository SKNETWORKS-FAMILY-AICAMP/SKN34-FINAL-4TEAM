package ai.storyfork.content.imagegeneration.controller
import ai.storyfork.content.imagegeneration.service.ImageJobService
import ai.storyfork.content.imagegeneration.service.dto.*
import jakarta.validation.Valid
import java.security.Principal
import java.util.UUID
import org.springframework.http.*
import org.springframework.web.bind.annotation.*

/** 인증된 소유자의 이미지 접수·조회·미리보기. 적용·발행은 기존 대상 API가 담당한다. */
@RestController
@RequestMapping("/api/v1/image-generations")
class ImageJobController(private val service:ImageJobService) {
 @PostMapping
 fun submit(principal:Principal,@RequestHeader("Idempotency-Key") key:UUID,@Valid @RequestBody request:ImageRequest)=
  ResponseEntity.status(202).body(service.submit(principal.name,key,request))
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
 @PostMapping("/progress") fun progress(@PathVariable id:UUID,@RequestBody r:ImageProgress)=service.progress(id,r.stage)
 @PostMapping("/failed") fun failed(@PathVariable id:UUID,@RequestBody r:ImageProgress)=service.failed(id,r.stage)
 @PostMapping("/interrupted") fun interrupted(@PathVariable id:UUID,@RequestBody r:ImageProgress)=service.failed(id,r.stage,true)
 @PostMapping("/complete") fun complete(@PathVariable id:UUID,@RequestBody r:ImageCompletion)=service.complete(id,r.key)
}
