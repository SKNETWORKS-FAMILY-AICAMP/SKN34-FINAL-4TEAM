package ai.storyfork.core.notification.controller

import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.NoticeStream
import ai.storyfork.core.notification.service.dto.NoticeGroupItemsRequest
import ai.storyfork.core.notification.service.dto.NoticeGroupListRequest
import ai.storyfork.core.notification.service.dto.NoticeGroupListResponse
import ai.storyfork.core.notification.service.dto.NoticeListRequest
import ai.storyfork.core.notification.service.dto.NoticeListResponse
import ai.storyfork.core.notification.service.dto.NoticeResponse
import ai.storyfork.core.notification.service.dto.ReadAllRequest
import ai.storyfork.core.notification.service.dto.UnreadCountResponse
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/** 로그인한 회원 본인의 알림함 목록·읽음·삭제 요청을 검증하고 HTTP 응답으로 변환한다. */
@RestController
class NoticeController(private val notices: NoticeService, private val stream: NoticeStream) {
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }
    private fun noticeId(raw: String): UUID = try { UUID.fromString(raw) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.NOT_FOUND) }

    /** 본인 알림을 최신순으로 반환한다. 잘못된 cursor·limit은 400이다. */
    @GetMapping("/api/v1/me/notifications")
    fun list(@AuthenticationPrincipal jwt: Jwt, @Valid @ModelAttribute request: NoticeListRequest): NoticeListResponse = notices.list(member(jwt), request)

    /** 같은 종류·대상의 알림을 묶어 최근 도착순으로 반환한다. 대상 없는 알림은 묶지 않는다. 잘못된 limit은 400이다. */
    @GetMapping("/api/v1/me/notifications/groups")
    fun groups(@AuthenticationPrincipal jwt: Jwt, @Valid @ModelAttribute request: NoticeGroupListRequest): NoticeGroupListResponse = notices.groups(member(jwt), request)

    /** 한 묶음(종류·대상)에 속한 개별 알림을 최신순으로 반환한다. 종류·대상이 없거나 limit이 잘못되면 400이다. */
    @GetMapping("/api/v1/me/notifications/groups/items")
    fun groupItems(@AuthenticationPrincipal jwt: Jwt, @Valid @ModelAttribute request: NoticeGroupItemsRequest): NoticeListResponse = notices.groupItems(member(jwt), request)

    /** 알림 하나를 반환한다. 읽음 처리는 하지 않으며 타인·삭제된 알림이나 UUID가 아닌 id는 404다. */
    @GetMapping("/api/v1/me/notifications/{id}")
    fun detail(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: String): NoticeResponse = notices.get(member(jwt), noticeId(id))

    /**
     * 본인 알림 변경 신호 스트림(SSE). 이벤트는 `ready`(연결·재연결 직후)와 `changed`(새 알림 저장 후)이며 내용은 담지 않는다.
     * 받은 쪽은 목록·미읽음 수를 다시 조회한다. 신호를 받았다는 것만으로 읽음 처리하지 않는다.
     */
    @GetMapping("/api/v1/me/notifications/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(@AuthenticationPrincipal jwt: Jwt): ResponseEntity<SseEmitter> =
        ResponseEntity.ok().header("Cache-Control", "no-cache").header("X-Accel-Buffering", "no").body(stream.subscribe(member(jwt)))

    /** 삭제되지 않은 본인의 미읽음 알림 수를 반환한다. */
    @GetMapping("/api/v1/me/notifications/unread-count")
    fun unreadCount(@AuthenticationPrincipal jwt: Jwt): UnreadCountResponse = notices.unreadCount(member(jwt))

    /** 알림 하나를 읽음 처리한다. 반복 호출도 204이고, 타인·삭제된 알림은 404다. */
    @PatchMapping("/api/v1/me/notifications/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun read(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: String) = notices.markRead(member(jwt), noticeId(id))

    /** upTo 이전에 도착한 미읽음 알림을 모두 읽음 처리한다. */
    @PostMapping("/api/v1/me/notifications/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun readAll(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: ReadAllRequest) = notices.markAllRead(member(jwt), request)

    /** 알림을 삭제 표시한다. 반복 호출도 204이고, 타인 알림은 404다. */
    @DeleteMapping("/api/v1/me/notifications/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: String) = notices.delete(member(jwt), noticeId(id))
}
