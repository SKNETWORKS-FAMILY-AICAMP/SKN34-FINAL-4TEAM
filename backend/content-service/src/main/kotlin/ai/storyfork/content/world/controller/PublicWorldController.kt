package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.PublicWorldCardSearchResponse
import ai.storyfork.content.world.service.dto.PublicWorldPageResponse
import ai.storyfork.content.world.service.dto.PublicWorldResponse
import java.util.UUID
import org.springframework.web.bind.annotation.*

/** 공개 세계관을 비로그인으로도 읽기 전용으로 제공한다. 카드는 소유자가 공개로 바꾼 것만 보인다(DEC-46). 세계관 참조 이용·Fork는 제공하지 않는다(DEC-35). */
@RestController
@RequestMapping("/api/v1/public/world-studios")
class PublicWorldController(private val service: PublicWorldService) {
    /**
     * 공개이고 저장 버전이 있는 세계관을 최근 공개순으로 반환한다. genre(코드, 생략·빈 값은 전체)·page(0부터)·size(1~100, 기본 24)는 선택이며
     * 잘못된 genre·음수 page·범위 밖 size·숫자 아닌 값은 422다(page·size는 문자열로 받아 Spring 타입 변환 400이 되지 않게 한다).
     * q(선택, 앞뒤 공백을 자르며 공백뿐이면 없는 것과 같다)가 있으면 확정 버전의 이름·설명과 작가 닉네임에 대소문자 무시로 들어 있는 세계관만 거른 뒤 페이지를 자르고 total도 거른 수다(#505).
     */
    @GetMapping
    fun list(@RequestParam(required = false) genre: String?, @RequestParam(required = false) q: String?, @RequestParam(required = false) page: String?, @RequestParam(required = false) size: String?): PublicWorldPageResponse =
        service.list(genre, q, page, size)

    /**
     * 공개 세계관의 설정 카드를 검색한다(#505). 상세와 같은 기준 회차로 독자에게 보이는 카드의 제목·별칭·태그(본문 제외)에서 q를 대소문자 무시로 찾고, 세계관 최근 공개순 → 카드 제목순으로 page(0부터)·size(1~100, 기본 24)만큼 반환한다.
     * q가 없거나 공백뿐이거나 음수 page·범위 밖 size·숫자 아닌 값은 422다. 리터럴 `/cards`는 `/{id}`(UUID)보다 먼저 매칭된다.
     */
    @GetMapping("/cards")
    fun cards(@RequestParam(required = false) q: String?, @RequestParam(required = false) page: String?, @RequestParam(required = false) size: String?): PublicWorldCardSearchResponse =
        service.cards(q, page, size)

    /** 마지막 저장 버전에서 기준 회차 이하로 공개된 카드와 그 카드끼리의 기준 회차 시점 관계를 반환한다(DEC-53). 비공개·저장 버전 없음·없는 세계관은 404이고 관계 저장소가 불확실하면 `relationshipStatus=unavailable`로 카드만 준다. */
    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID): PublicWorldResponse = service.detail(id)

    /** 공개 세계관의 표지 이미지를 캐시 없이 반환한다. 상세와 같은 기준(공개·확정 버전)이며 비공개·확정 버전 없음·표지 없음·없는 세계관은 404다. */
    @GetMapping("/{id}/cover")
    fun cover(@PathVariable id: UUID) = coverImage(service.cover(id))

    /**
     * 공개 세계관의 설정 카드 이미지를 캐시 없이 반환한다(#401). 상세와 같은 기준(공개·확정 버전)이고, 그 확정 버전의 공개·활성 카드 중 하나가 `imageId`로 가리키는 이미지일 때만이다.
     * 비공개·확정 버전 없음·가리키는 카드 없음(비공개·삭제 카드, 초안에만 있는 참조 포함)·없는 이미지는 404다.
     */
    @GetMapping("/{id}/card-images/{imageId}")
    fun cardImage(@PathVariable id: UUID, @PathVariable imageId: UUID) = coverImage(service.cardImage(id, imageId))
}
