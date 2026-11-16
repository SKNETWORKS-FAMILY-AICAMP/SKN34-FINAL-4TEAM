package ai.storyfork.content.episode.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.web.bind.annotation.*
import org.springframework.http.HttpStatus
import ai.storyfork.content.episode.service.dto.*

/** 회차 CRUD와 순서 변경 제약 조회를 제공한다. 참조 이력은 연쇄 삭제하지 않는다. */
@RestController
@RequestMapping("/api/v1")
class EpisodeController(private val service: ai.storyfork.content.episode.service.EpisodeService) {

    /** 소유자의 회차 목록을 JSON 배열로 반환한다. 인증 필요, 접근 불가 작품은 404다. */
    @GetMapping("/works/{id}/episodes")
    fun list(@PathVariable id: String, principal: Principal): EpisodeListResponse = service.list(id,principal.name)

    /** 제목 DTO로 비공개 회차를 만든다. 소유자만 가능하며 입력 오류는 422다. */
    @PostMapping("/works/{id}/episodes") @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: CreateEpisodeRequest): EpisodeResponse = service.create(id,principal.name,data)

    /** 회차 상세 DTO를 반환한다. 소유자만 가능하며 작품·회차가 없으면 404다. */
    @GetMapping("/works/{id}/episodes/{number}")
    fun read(@PathVariable id: String,@PathVariable number: Int,principal: Principal): EpisodeResponse = service.read(id,principal.name,number)

    /** 원고 DTO로 초안만 수정한다. 상속 회차는 403, revision 충돌은 409, 입력 오류는 422다. */
    @PutMapping("/works/{id}/episodes/{number}/draft")
    fun update(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@Valid @RequestBody data: DraftRequest): EpisodeResponse = service.update(id,principal.name,number,data)

    /** 소유자에게 순서 변경 후보와 제한 사유를 반환한다. 실제 이동은 하지 않는다. */
    @GetMapping("/works/{id}/episodes/{number}/order-scope")
    fun orderScope(@PathVariable id:String,@PathVariable number:Int,principal:Principal) = service.orderScope(id,principal.name,number)

    /** 소유자의 작업 초안만 제거한다. 상속은 403, 편집 충돌은 409이며 저장 버전은 보존한다. */
    @DeleteMapping("/works/{id}/episodes/{number}/draft") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun deleteDraft(@PathVariable id:String,@PathVariable number:Int,@RequestParam revision:Int,principal:Principal) = service.deleteDraft(id,principal.name,number,revision)

    /** 소유자의 참조 없는 마지막 회차를 소프트 삭제한다. 상속은 403, 참조·충돌은 409다. */
    @DeleteMapping("/works/{id}/episodes/{number}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun deleteEpisode(@PathVariable id:String,@PathVariable number:Int,@RequestParam revision:Int,principal:Principal) = service.deleteEpisode(id,principal.name,number,revision)

}
