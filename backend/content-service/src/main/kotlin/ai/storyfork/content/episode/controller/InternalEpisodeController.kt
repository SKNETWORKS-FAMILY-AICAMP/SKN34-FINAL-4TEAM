package ai.storyfork.content.episode.controller

import ai.storyfork.content.episode.service.InternalEpisodeService
import ai.storyfork.content.episode.service.dto.OperationsEpisodeResponse
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 내부 API. `/internal/v1` 하위의 운영 서비스 토큰 체인만 지나며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/works/{workId}/episodes")
class InternalEpisodeController(private val service: InternalEpisodeService) {
    /** 작품의 회차(번호순, 본문 없음)와 발행·제한·상속 상태다. 없거나 지운 작품은 404다. */
    @GetMapping
    fun list(@PathVariable workId: String): List<OperationsEpisodeResponse> = service.list(workId)

    /** 회차를 제한해 독자 열람·조회수·댓글에서 뺀다(멱등). 상속 회차는 409 EPISODE_INHERITED, 없는 회차는 404다. */
    @PutMapping("/{number}/restriction")
    fun restrict(@PathVariable workId: String, @PathVariable number: Int): OperationsEpisodeResponse = service.restrict(workId, number, true)

    /** 회차 제한을 해제한다(멱등). */
    @DeleteMapping("/{number}/restriction")
    fun unrestrict(@PathVariable workId: String, @PathVariable number: Int): OperationsEpisodeResponse = service.restrict(workId, number, false)
}
