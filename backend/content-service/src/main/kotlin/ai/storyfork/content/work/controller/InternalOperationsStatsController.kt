package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.OperationsFunnelService
import ai.storyfork.content.work.service.OperationsStatsService
import ai.storyfork.content.work.service.dto.OperationsFunnelResponse
import ai.storyfork.content.work.service.dto.OperationsStatsResponse
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 내부 API. `X-Operations-Service-Token`만으로 인증하며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/operations")
class InternalOperationsStatsController(private val service: OperationsStatsService, private val funnels: OperationsFunnelService) {
    /** 작가 검토 대기 수와 기간(`from`·`to`, ISO-8601, 생략하면 최근 7일) 안의 AI 제안 채택·수정 제안 승인 수다. 값 오류는 422다. */
    @GetMapping("/stats")
    fun stats(@RequestParam(required = false) from: String?, @RequestParam(required = false) to: String?): OperationsStatsResponse = service.stats(from, to)

    /** 전체 기간의 퍼널 지표(DEC-57)다. 파라미터가 없고 수만 센다(비율·오차는 화면이 계산한다). */
    @GetMapping("/funnel")
    fun funnel(): OperationsFunnelResponse = funnels.funnel()
}
