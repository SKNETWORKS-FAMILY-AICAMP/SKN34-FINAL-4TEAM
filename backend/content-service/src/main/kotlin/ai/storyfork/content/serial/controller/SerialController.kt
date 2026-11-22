package ai.storyfork.content.serial.controller

import ai.storyfork.content.serial.service.SerialRunner
import ai.storyfork.content.serial.service.SerialService
import ai.storyfork.content.serial.service.dto.SerialBoardRecord
import ai.storyfork.content.serial.service.dto.SerialBoardResponse
import ai.storyfork.content.serial.service.dto.SerialOpinionCreated
import ai.storyfork.content.serial.service.dto.SerialOpinionRequest
import ai.storyfork.content.serial.service.dto.SerialSettingsRequest
import ai.storyfork.content.serial.service.dto.SerialSettingsResponse
import ai.storyfork.content.serial.service.dto.SerialVoteRequest
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/**
 * AI 자율 연재(UC-18)의 공개 API다. 설정·지금 실행·기록은 작품 소유자만 쓰고(남의 작품은 404), 독자 게시판 읽기는 익명도 되며(공개 작품만),
 * 의견·투표는 로그인 회원이 한다. 오류는 detail·code JSON이다. 계약: docs/design/ai-serial-contract.md.
 */
@RestController
@RequestMapping("/api/v1/works/{id}")
class SerialController(private val service: SerialService, private val runner: SerialRunner) {
    /** 소유자의 설정이다. 저장한 적이 없으면 꺼짐 기본값 200이다. */
    @GetMapping("/ai-serial")
    fun settings(@PathVariable id: String, principal: Principal): SerialSettingsResponse = service.settings(id, principal.name)

    /** 설정을 저장한다(세계관 연결은 필요 없다). 입력 오류는 422다. 켜져 있고 발행된 회차가 있으면 다음 회차 게시판이 열린다. */
    @PutMapping("/ai-serial")
    fun save(@PathVariable id: String, principal: Principal, @RequestBody data: SerialSettingsRequest): SerialSettingsResponse = service.saveSettings(id, principal.name, data)

    /** 열린 게시판을 지금 마감·실행하도록 요청한다(202, 본문 없음). 꺼짐 409 SERIAL_DISABLED·열린 게시판 없음 409 SERIAL_NO_BOARD·이미 실행 중 409 SERIAL_RUNNING이다. */
    @PostMapping("/ai-serial/run")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun run(@PathVariable id: String, principal: Principal) = service.run(id, principal.name)

    /** 게시판 기록을 최신순으로 최대 50개 JSON 배열로 돌려준다. */
    @GetMapping("/ai-serial/boards")
    fun boards(@PathVariable id: String, principal: Principal): List<SerialBoardRecord> = service.boards(id, principal.name)

    /** 독자용 게시판이다. 공개 작품은 익명도 읽고 Bearer가 있으면 내 의견·내 투표를 채운다. 비공개·없는 작품은 404다. */
    @GetMapping("/serial-board")
    fun board(@PathVariable id: String, principal: Principal?): SerialBoardResponse = service.board(id, principal?.name)

    /** 의견을 낸다(201). 이미 냈으면 409 OPINION_EXISTS, 열린 게시판이 없으면 409 SERIAL_NO_BOARD, 시뮬레이션은 크레딧이 모자라면 409 INSUFFICIENT_CREDIT이다. */
    @PostMapping("/serial-board/opinions")
    @ResponseStatus(HttpStatus.CREATED)
    fun opinion(@PathVariable id: String, principal: Principal, @RequestBody data: SerialOpinionRequest): SerialOpinionCreated = runner.submit(id, principal.name, data)

    /** 투표하거나 다른 의견으로 옮긴다(204). */
    @PutMapping("/serial-board/vote")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun vote(@PathVariable id: String, principal: Principal, @RequestBody data: SerialVoteRequest) = service.vote(id, principal.name, data.opinionId)

    /** 내 표를 취소한다(204). */
    @DeleteMapping("/serial-board/vote")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun cancelVote(@PathVariable id: String, principal: Principal) = service.cancelVote(id, principal.name)

    /** 소유자가 의견을 숨긴다(204). */
    @PostMapping("/serial-board/opinions/{opinionId}/hide")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun hide(@PathVariable id: String, @PathVariable opinionId: String, principal: Principal) = service.hide(id, principal.name, opinionId)
}
