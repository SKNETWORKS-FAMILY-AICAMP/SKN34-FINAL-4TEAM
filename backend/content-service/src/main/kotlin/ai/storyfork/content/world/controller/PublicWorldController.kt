package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.PublicWorldPageResponse
import ai.storyfork.content.world.service.dto.PublicWorldResponse
import java.util.UUID
import org.springframework.web.bind.annotation.*

/** 공개 세계관을 비로그인으로도 읽기 전용으로 제공한다. 세계관 이용·복사·Fork는 제공하지 않는다(DEC-35). */
@RestController
@RequestMapping("/api/v1/public/world-studios")
class PublicWorldController(private val service: PublicWorldService) {
    /**
     * 공개이고 저장 버전이 있는 세계관을 최근 공개순으로 반환한다. genre(코드, 생략·빈 값은 전체)·page(0부터)·size(1~100, 기본 24)는 선택이며
     * 잘못된 genre·음수 page·범위 밖 size·숫자 아닌 값은 422다(page·size는 문자열로 받아 Spring 타입 변환 400이 되지 않게 한다).
     */
    @GetMapping
    fun list(@RequestParam(required = false) genre: String?, @RequestParam(required = false) page: String?, @RequestParam(required = false) size: String?): PublicWorldPageResponse =
        service.list(genre, page, size)

    /** 마지막 저장 버전의 카드와 현재 관계를 반환한다. 비공개·저장 버전 없음·없는 세계관은 404이고 관계 저장소가 불확실하면 `relationshipStatus=unavailable`로 카드만 준다. */
    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID): PublicWorldResponse = service.detail(id)

    /** 공개 세계관의 표지 이미지를 캐시 없이 반환한다. 상세와 같은 기준(공개·확정 버전)이며 비공개·확정 버전 없음·표지 없음·없는 세계관은 404다. */
    @GetMapping("/{id}/cover")
    fun cover(@PathVariable id: UUID) = coverImage(service.cover(id))
}
