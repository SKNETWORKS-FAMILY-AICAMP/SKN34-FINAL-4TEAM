package ai.storyfork.content.work.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.web.bind.annotation.*
import org.springframework.http.HttpStatus
import ai.storyfork.content.work.service.dto.*

/** 작품 등록·조회·수정·삭제·작품 정책과 기존 이력 조회 계약을 제공한다. */
@RestController
@RequestMapping("/api/v1")
class WorkController(
    private val service: ai.storyfork.content.work.service.WorkService,
    private val views: ai.storyfork.content.work.service.WorkViewService,
) {

    /** 인증된 작성자 소유 작품 목록 DTO를 JSON 배열로 반환한다. */
    @GetMapping("/works")
    fun list(principal: Principal): WorkListResponse = service.list(principal.name)

    /** 제목·소개 DTO로 비공개 작품을 만든다. 인증 필요, 입력 오류는 422다. */
    @PostMapping("/works") @ResponseStatus(HttpStatus.CREATED)
    fun create(principal: Principal,@Valid @RequestBody data: CreateWorkRequest): WorkResponse = service.create(principal.name,data)

    /** 작품 상세 DTO를 반환한다. 소유자만 가능하며 접근 불가는 404다. */
    @GetMapping("/works/{id}")
    fun read(@PathVariable id: String,principal: Principal): WorkResponse = service.read(id,principal.name)

    /** 작품 제목·소개를 수정한다. 소유자만 가능하며 revision 충돌은 409, 입력 오류는 422다. */
    @PutMapping("/works/{id}")
    fun update(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: UpdateWorkRequest): WorkResponse = service.update(id,principal.name,data)

    /** 작품을 삭제한다. 소유자만 가능하며 접근 불가는 404, 세계관 설정·발행·저장 이력이 있거나 분기 작품이면 409다. */
    @DeleteMapping("/works/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: String,principal: Principal) = service.delete(id,principal.name)

    /** 저장 버전·제안·정책·발행 이력을 기존 복합 DTO로 반환한다. 소유자만 가능하며 접근 불가는 404다. */
    @GetMapping("/works/{id}/history")
    fun history(@PathVariable id: String,principal: Principal): HistoryResponse = service.history(id,principal.name)

    /** 원작의 분기 허용 정책을 변경한다. 소유자만 가능하며 Fork는 403, revision 충돌은 409다. */
    @PutMapping("/works/{id}/policy")
    fun policy(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: PolicyRequest): WorkResponse = service.policy(id,principal.name,data)

    /** 공개 작품 목록을 초안 없이 반환한다. 익명 조회를 허용한다. q(제목·작가명·해시태그·장르 부분 일치)·f(all|title|author|tag|genre)·sort(latest|view)는 선택이며 잘못된 f·sort는 422다. */
    @GetMapping("/public/works")
    fun publicList(@RequestParam(required=false) q: String?,@RequestParam(required=false) f: String?,@RequestParam(required=false) sort: String?): WorkListResponse = service.publicList(q,f,sort)

    /** 최근 24시간 조회 기준 실시간 인기(top)·급상승(rising) 공개 작품을 최대 10개 반환한다. 익명 가능, kind 누락은 400·잘못된 값은 422다. */
    @GetMapping("/public/works/ranking")
    fun ranking(@RequestParam kind: String): WorkListResponse = service.ranking(kind)

    /** 공개 작품 DTO를 초안 없이 반환한다. 익명 가능, 비공개·없는 작품은 404다. */
    @GetMapping("/public/works/{id}")
    fun publicRead(@PathVariable id: String): WorkResponse = service.publicRead(id)

    /** 공개 작품의 발행 회차 열람을 회원·회차별 하루 1회 기록한다. 같은 날 중복은 무시하고 204이며, 비공개 작품·미발행 회차는 404다. */
    @PostMapping("/works/{id}/episodes/{number}/views") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun recordView(@PathVariable id: String,@PathVariable number: Int,principal: Principal) = views.record(id,number,principal.name)

}
