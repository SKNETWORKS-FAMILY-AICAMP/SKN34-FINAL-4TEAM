package ai.storyfork.core.content.controller

import ai.storyfork.core.content.controller.dto.*
import ai.storyfork.core.content.domain.ContentFailure
import ai.storyfork.core.content.service.ContentService
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"],havingValue="true")
class ContentController(private val service: ContentService, @Value("\${app.content.dev-owner:}") private val devOwner: String, @Value("\${app.cors.allowed-origin}") private val allowedOrigin: String) {
    private fun owner(request: HttpServletRequest): String {
        // Never trust a caller-provided user ID/header or the React demo role.
        val origin=request.getHeader("Origin")
        if(request.method !in setOf("GET","HEAD","OPTIONS") && origin!=null && origin!=allowedOrigin) throw ContentFailure(403,"허용되지 않은 요청 출처입니다.")
        return request.userPrincipal?.name?.takeIf { it.isNotBlank() && it.length<=200 }
            ?: devOwner.takeIf { it.isNotBlank() && request.remoteAddr in setOf("127.0.0.1","0:0:0:0:0:0:0:1","::1") }
            ?: throw ContentFailure(401,"서버 인증이 필요합니다. 화면의 데모 로그인은 API 인증이 아닙니다.")
    }
    @GetMapping("/works") fun list(r: HttpServletRequest) = service.list(owner(r))
    @PostMapping("/works") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    fun create(r: HttpServletRequest,@Valid @RequestBody d: CreateWorkRequest) = service.create(owner(r),d)
    @GetMapping("/works/{id}") fun read(r: HttpServletRequest,@PathVariable id: String) = service.read(id,owner(r))
    @PutMapping("/works/{id}/draft") fun edit(r: HttpServletRequest,@PathVariable id: String,@Valid @RequestBody d: DraftRequest) = service.edit(id,owner(r),d)
    @GetMapping("/works/{id}/history") fun history(r: HttpServletRequest,@PathVariable id: String) = service.history(id,owner(r))
    @PutMapping("/works/{id}/policy") fun policy(r: HttpServletRequest,@PathVariable id: String,@Valid @RequestBody d: PolicyRequest) = service.policy(id,owner(r),d)
    @PostMapping("/works/{id}/publish") fun publish(r: HttpServletRequest,@PathVariable id: String,@Valid @RequestBody d: PublishRequest) = service.publish(id,owner(r),d)
    @PostMapping("/works/{id}/forks") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    fun fork(r: HttpServletRequest,@PathVariable id: String,@Valid @RequestBody d: ForkRequest) = service.fork(id,owner(r),d)
    @GetMapping("/works/{id}/world") fun world(r: HttpServletRequest,@PathVariable id: String) = service.world(id,owner(r))
    @PutMapping("/works/{id}/settings/{sid}/draft") fun setting(r: HttpServletRequest,@PathVariable id: String,@PathVariable sid: String,@Valid @RequestBody d: SettingRequest) = service.saveSetting(id,sid,owner(r),d)
    @PostMapping("/works/{id}/settings/{sid}/commit") fun commit(r: HttpServletRequest,@PathVariable id: String,@PathVariable sid: String,@Valid @RequestBody d: RevisionRequest) = service.commitSetting(id,sid,owner(r),d.revision)
    @PostMapping("/works/{id}/settings/{sid}/revert") fun revert(r: HttpServletRequest,@PathVariable id: String,@PathVariable sid: String,@Valid @RequestBody d: RevertRequest) = service.revertSetting(id,sid,owner(r),d)
    @PostMapping("/works/{id}/world/changes") fun change(r: HttpServletRequest,@PathVariable id: String,@Valid @RequestBody d: ChangeRequest) = service.change(id,owner(r),d)
    @GetMapping("/works/{id}/context") fun context(r: HttpServletRequest,@PathVariable id: String,@RequestParam episode: Int,@RequestParam(defaultValue="") query: String,@RequestParam(defaultValue="") character: String) = service.readContext(id,owner(r),episode,query,character)
    @PostMapping("/works/{id}/proposals") fun propose(r: HttpServletRequest,@PathVariable id: String,@Valid @RequestBody d: ProposalRequest) = service.propose(id,owner(r),d)
    @PostMapping("/works/{id}/proposals/{pid}/accept") fun accept(r: HttpServletRequest,@PathVariable id: String,@PathVariable pid: String,@Valid @RequestBody d: RevisionRequest) = service.accept(id,pid,owner(r),d.revision)
    @GetMapping("/public/works") fun publicList() = service.publicList()
    @GetMapping("/public/works/{id}") fun publicRead(@PathVariable id: String) = service.publicRead(id)
    @GetMapping("/public/works/{id}/context") fun publicContext(@PathVariable id: String,@RequestParam episode: Int,@RequestParam(defaultValue="") query: String,@RequestParam(defaultValue="") character: String) = service.readContext(id,null,episode,query,character)
}

@RestControllerAdvice(assignableTypes=[ContentController::class])
class ContentExceptionHandler {
    @ExceptionHandler(ContentFailure::class) fun failure(e: ContentFailure) = ResponseEntity.status(e.status).body(mapOf("detail" to e.message))
    @ExceptionHandler(MethodArgumentNotValidException::class) fun invalid() = ResponseEntity.unprocessableContent().body(mapOf("detail" to "입력 길이·회차·필수 항목을 확인해 주세요."))
}
