package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import java.security.Principal
import java.util.UUID
import org.springframework.web.bind.annotation.*

/** 인증된 소유자의 독립 세계관과 현재 관계를 제공한다. 공개 조회·관계 이력 API는 제공하지 않는다. */
@RestController
@RequestMapping("/api/v1/world-studios")
class WorldStudioController(private val service:WorldStudioService) {
    /** 소유 세계관 요약을 반환하며 미전환·미완료 상태도 표시한다. */
    @GetMapping
    fun list(principal:Principal)=service.list(UUID.fromString(principal.name))

    /** caller UUID로 생성/동일 입력 재시도를 처리한다. 권한 오류는 404, 입력 오류는 422다. */
    @PostMapping
    fun create(principal:Principal,@RequestBody request:CreateWorldRequest)=service.create(UUID.fromString(principal.name),request)

    /** 소유자의 카드 초안과 일치하는 현재 Neo4j 관계만 반환한다. 미전환/불일치는 409, 미완료는 503이다. */
    @GetMapping("/{id}")
    fun read(@PathVariable id:UUID,principal:Principal)=service.draft(id,UUID.fromString(principal.name))

    /** 예상 revision과 요청 키로 현재 상태를 저장한다. 확정 비적용 409는 재조회·수정하며 결과 미확인 충돌은 동일 입력으로 재시도한다. */
    @PutMapping("/{id}/draft")
    fun edit(@PathVariable id:UUID,principal:Principal,@RequestBody request:EditWorldDraftRequest)=service.edit(id,UUID.fromString(principal.name),request)

    /** 카드/설정 버전을 확정한다. 관계 과거 상태는 저장하지 않으며 응답에서도 not_recorded로 구분한다. */
    @PostMapping("/{id}/revisions")
    fun save(@PathVariable id:UUID,principal:Principal,@RequestBody request:SaveWorldRequest)=service.save(id,UUID.fromString(principal.name),request)

    @GetMapping("/{id}/revisions")
    fun revisions(@PathVariable id:UUID,principal:Principal)=service.revisionSummaries(id,UUID.fromString(principal.name))

    /** 기존 카드/설정 불변 버전만 조회한다. 현재 관계를 과거 관계로 섞지 않는다. */
    @GetMapping("/{id}/revisions/{revisionId}")
    fun revision(@PathVariable id:UUID,@PathVariable revisionId:UUID,principal:Principal)=service.revision(id,UUID.fromString(principal.name),revisionId)
}
