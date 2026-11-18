package ai.storyfork.content.world.controller

import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.domain.episodeFromText
import ai.storyfork.content.world.domain.worldCoverFile
import ai.storyfork.content.world.service.WorldCardImageService
import ai.storyfork.content.world.service.WorldCoverService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import java.security.Principal
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile

/**
 * 인증된 소유자의 독립 세계관과 현재 관계를 제공한다. 공개 세계관의 비로그인 읽기 API는 [PublicWorldController]가 맡고,
 * 관계 이력 API는 제공하지 않는다. 목록과 초안 응답에는 이 세계관에 연결된 소설(`linkedWorkId`, 1:1, DEC-46)을 붙인다.
 * 연결의 정본은 작품 쪽(`work.world_studio_id`)이라 세계관 조회·저장을 마친 뒤 따로 읽는다.
 */
@RestController
@RequestMapping("/api/v1/world-studios")
class WorldStudioController(private val service:WorldStudioService,private val covers:WorldCoverService,private val links:WorkWorldService,private val cardImages:WorldCardImageService) {
    /** 소유 세계관 요약을 반환하며 미전환·미완료 상태도 표시한다. */
    @GetMapping
    fun list(principal:Principal):List<WorldStudioSummaryResponse> {
        val rows=service.list(UUID.fromString(principal.name));val linked=links.linkedWorkIds(rows.map { it.worldId })
        return rows.map { it.copy(linkedWorkId=linked[it.worldId]) }
    }
    private fun linked(draft:WorldDraftResponse)=draft.copy(linkedWorkId=links.linkedWorkIds(listOf(draft.worldId))[draft.worldId])

    /** caller UUID로 생성/동일 입력 재시도를 처리한다. 권한 오류는 404, 입력 오류는 422다. */
    @PostMapping
    fun create(principal:Principal,@RequestBody request:CreateWorldRequest)=linked(service.create(UUID.fromString(principal.name),request))

    /**
     * 소유자의 카드 초안과 일치하는 Neo4j 관계를 반환한다. 관계는 `episode`(연결된 소설의 회차 순번, 1 이상) 시점의 것이며 생략하면 최신 회차다(DEC-51).
     * 미전환/불일치는 409, 미완료는 503, `episode` 값 오류는 422다(문자열로 받아 Spring 타입 변환 400이 되지 않게 한다).
     */
    @GetMapping("/{id}")
    fun read(@PathVariable id:UUID,principal:Principal,@RequestParam(required=false) episode:String?=null)=
        linked(service.draft(id,UUID.fromString(principal.name),episodeFromText(episode)))

    /** 예상 revision과 요청 키로 `episode`(생략하면 최신 회차) 시점의 관계를 저장한다(DEC-51). 확정 비적용 409는 재조회·수정하며 결과 미확인 충돌은 동일 입력으로 재시도한다. */
    @PutMapping("/{id}/draft")
    fun edit(@PathVariable id:UUID,principal:Principal,@RequestBody request:EditWorldDraftRequest)=linked(service.edit(id,UUID.fromString(principal.name),request))

    /** 카드/설정 버전을 확정한다. 관계 과거 상태는 저장하지 않으며 응답에서도 not_recorded로 구분한다. */
    @PostMapping("/{id}/revisions")
    fun save(@PathVariable id:UUID,principal:Principal,@RequestBody request:SaveWorldRequest)=service.save(id,UUID.fromString(principal.name),request)

    /** 소유자가 세계관의 공개 범위(private|public)와 장르를 바꾼다. 저장 버전이 없으면 설정만 되고 `listed=false`다. 비소유자는 404, 값 오류는 422다. */
    @PutMapping("/{id}/publication")
    fun publication(@PathVariable id:UUID,principal:Principal,@RequestBody request:PublicationRequest)=service.publication(id,UUID.fromString(principal.name),request)

    /** 소유자가 PNG·JPEG·WebP(5MB 이하) multipart `file`로 세계관 표지를 저장·교체한다. 값 오류(422)는 소유 확인(비소유자 404)보다 먼저다. */
    @PutMapping("/{id}/cover",consumes=[MediaType.MULTIPART_FORM_DATA_VALUE])
    fun putCover(@PathVariable id:UUID,principal:Principal,@RequestParam("file",required=false) file:MultipartFile?)=
        covers.put(id,UUID.fromString(principal.name),worldCoverFile(file))

    /** 소유자가 세계관 표지를 지운다. 표지가 없어도 204다. */
    @DeleteMapping("/{id}/cover")
    fun deleteCover(@PathVariable id:UUID,principal:Principal):ResponseEntity<Void> {
        covers.delete(id,UUID.fromString(principal.name))
        return ResponseEntity.noContent().build()
    }

    /** 소유자에게 표지 이미지를 캐시 없이 돌려준다. 표지가 없거나 남의 세계관이면 404다. */
    @GetMapping("/{id}/cover")
    fun readCover(@PathVariable id:UUID,principal:Principal)=coverImage(covers.read(id,UUID.fromString(principal.name)))

    /**
     * 소유자가 PNG·JPEG·WebP(5MB 이하) multipart `file`로 설정 카드 대표 이미지를 올린다(#401). 201과 새 이미지 ID이며, 카드에 붙이는 것은 화면이 초안 카드의
     * `semanticMetadata.imageId`에 넣어 초안을 저장해서 한다. 값 오류(422)는 소유 확인(비소유자 404)보다 먼저다.
     */
    @PostMapping("/{id}/card-images",consumes=[MediaType.MULTIPART_FORM_DATA_VALUE])
    fun uploadCardImage(@PathVariable id:UUID,principal:Principal,@RequestParam("file",required=false) file:MultipartFile?):ResponseEntity<WorldCardImageResponse> =
        ResponseEntity.status(HttpStatus.CREATED).body(cardImages.put(id,UUID.fromString(principal.name),worldCoverFile(file)))

    /** 소유자에게 설정 카드 이미지를 캐시 없이 돌려준다. 없는 ID·다른 세계관의 ID·남의 세계관이면 404다. */
    @GetMapping("/{id}/card-images/{imageId}")
    fun readCardImage(@PathVariable id:UUID,@PathVariable imageId:UUID,principal:Principal)=coverImage(cardImages.read(id,UUID.fromString(principal.name),imageId))

    /** 소유한 세계관의 봉인된 버전 식별자와 저장 시각을 최신순으로 반환한다. */
    @GetMapping("/{id}/revisions")
    fun revisions(@PathVariable id: UUID, principal: Principal) = service.revisionSummaries(id, UUID.fromString(principal.name))

    /** 기존 카드/설정 불변 버전만 조회한다. 현재 관계를 과거 관계로 섞지 않는다. */
    @GetMapping("/{id}/revisions/{revisionId}")
    fun revision(@PathVariable id:UUID,@PathVariable revisionId:UUID,principal:Principal)=service.revision(id,UUID.fromString(principal.name),revisionId)

    /**
     * 소유자가 확정 버전의 카드로 초안의 카드만 되돌린다(관계·이름·새 확정 버전은 그대로). 응답은 되돌린 초안이다. 없는 버전·남의 세계관은 404, 낡은 초안 revision은 409,
     * 사라질 설정에 현재 관계가 이어져 있으면 409 `WORLD_RESTORE_BLOCKED`다.
     */
    @PostMapping("/{id}/revisions/{revisionId}/restore")
    fun restore(@PathVariable id:UUID,@PathVariable revisionId:UUID,principal:Principal,@RequestBody request:RestoreWorldRequest)=
        linked(service.restore(id,UUID.fromString(principal.name),revisionId,request))

    /** 소유자가 세계관을 지운다(소프트 삭제, 204). 연결된 소설이 있으면 409 `WORLD_LINKED`, 남의 세계관·이미 지운 세계관은 404다. */
    @DeleteMapping("/{id}")
    fun delete(@PathVariable id:UUID,principal:Principal):ResponseEntity<Void> {
        service.delete(id,UUID.fromString(principal.name),links.linkedWorkIds(listOf(id)).containsKey(id))
        return ResponseEntity.noContent().build()
    }
}
