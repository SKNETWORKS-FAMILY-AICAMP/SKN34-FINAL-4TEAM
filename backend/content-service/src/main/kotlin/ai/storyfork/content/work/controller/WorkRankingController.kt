package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkRankingResponse
import org.springframework.web.bind.annotation.*

/** 기간별 작품 랭킹·인기 추이(기능표 45) 공개 계약을 제공한다. 기존 [WorkController]의 `/public/works/ranking`은 그대로 둔다. */
@RestController
@RequestMapping("/api/v1")
class WorkRankingController(private val service: WorkService) {

    /**
     * 기간·종류·범위별 공개 작품 랭킹과 계산 시각을 반환한다. 익명 가능하다. kind(view|rising|popular|latest|updated)는 필수라 누락은 400이고,
     * period(day|week|month, 기본 day)·type(all|original|fork, 기본 all)·limit(1~50, 기본 10)은 선택이며 잘못된 값·범위 밖 limit은 422다.
     */
    @GetMapping("/public/works/rankings")
    fun rankings(@RequestParam kind: String,@RequestParam(required=false) period: String?,@RequestParam(required=false) type: String?,@RequestParam(required=false) limit: String?): WorkRankingResponse =
        service.rankings(kind,period,type,limit)

}
