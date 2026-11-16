package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.WorkTagSuggestionService
import ai.storyfork.content.work.service.dto.WorkTagSuggestionResponse
import java.security.Principal
import org.springframework.web.bind.annotation.*

/** 작품 장르·키워드(해시태그) 자동 추천(#372). 후보만 돌려주고 저장은 기존 작품 수정 API가 한다. */
@RestController
@RequestMapping("/api/v1")
class WorkTagSuggestionController(private val service: WorkTagSuggestionService) {
    /**
     * 작가 본인 작품의 제목·소개와 발행 회차(상속 회차 제외, 앞에서 최대 3개)로 장르 1~2개와 키워드 최대 10개 후보를 받는다.
     * 소유자가 아니거나 없는 작품은 404, 발행 회차가 없으면 409, AI 결과 오류는 502, AI 사용 불가는 503, 시간 초과는 504다.
     */
    @PostMapping("/works/{id}/tag-suggestions")
    fun suggest(@PathVariable id: String, principal: Principal): WorkTagSuggestionResponse = service.suggest(id, principal.name)
}
