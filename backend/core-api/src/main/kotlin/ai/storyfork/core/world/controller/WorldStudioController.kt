package ai.storyfork.core.world.controller

import ai.storyfork.core.world.domain.*
import ai.storyfork.core.world.service.WorldStudioService
import jakarta.servlet.http.HttpSession
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

@RestController
@RequestMapping("/api/v1/studio")
@ConditionalOnProperty(name=["STUDIO_ENABLED"],havingValue="true")
class WorldStudioController(private val service:WorldStudioService) {
 private fun actor(s:HttpSession)=(s.getAttribute("studioActor") as? String)?.takeIf {it in setOf("author","reader1","reader2")} ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
 data class SessionRequest(val actor:String)
 // Local-only identities reuse the original studio session contract; this is not production login.
 @PostMapping("/session") fun session(s:HttpSession,@RequestBody r:SessionRequest):Any {
  require(r.actor in setOf("author","reader1","reader2"));s.setAttribute("studioActor",r.actor);return mapOf("actor" to r.actor)
 }
 @GetMapping("/session") fun session(s:HttpSession):Any=mapOf("actor" to actor(s))
 @GetMapping("/worlds") fun list(s:HttpSession)=service.list(actor(s))
 @GetMapping("/worlds/{id}") fun read(s:HttpSession,@PathVariable id:String)=service.read(actor(s),id)
 @GetMapping("/worlds/{id}/history") fun history(s:HttpSession,@PathVariable id:String)=service.history(actor(s),id)
 data class CreateRequest(val name:String,val description:String="")
 data class SaveRequest(val version:Int,val name:String,val description:String,val settings:List<StudioSetting>)
 @PostMapping("/worlds") fun create(s:HttpSession,@RequestBody r:CreateRequest)=service.create(actor(s),r.name,r.description)
 @PutMapping("/worlds/{id}") fun save(s:HttpSession,@PathVariable id:String,@RequestBody r:SaveRequest)=service.save(actor(s),id,r.version,r.name,r.description,r.settings)
 @ExceptionHandler(IllegalArgumentException::class,IllegalStateException::class)
 @ResponseStatus(HttpStatus.CONFLICT)
 fun invalid(e:Exception)=ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,e.message ?: "입력과 저장 상태를 확인해 주세요.")
 @ExceptionHandler(org.springframework.dao.DataAccessException::class)
 @ResponseStatus(HttpStatus.CONFLICT)
 fun databaseFailure()=ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,"저장하지 못했습니다. 입력을 보존하고 다시 열어 저장 상태를 확인해 주세요.")
}
