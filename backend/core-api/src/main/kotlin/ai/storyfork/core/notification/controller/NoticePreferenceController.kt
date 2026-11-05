package ai.storyfork.core.notification.controller

import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.dto.NoticePreferencesRequest
import ai.storyfork.core.notification.service.dto.NoticePreferencesResponse
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

/** 로그인한 회원의 알림 분류별 수신 설정 조회·변경을 담당한다. */
@RestController
class NoticePreferenceController(private val notices: NoticeService) {
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    /** 모든 분류의 수신 여부를 반환한다. 저장된 값이 없으면 켜짐이고, 끌 수 없는 분류는 mutable=false다. */
    @GetMapping("/api/v1/me/notification-preferences")
    fun get(@AuthenticationPrincipal jwt: Jwt): NoticePreferencesResponse = notices.preferences(member(jwt))

    /** 읽기·창작 분류를 켜고 끈다. 알 수 없는 분류·중복·끌 수 없는 분류 끄기는 400이다. */
    @PutMapping("/api/v1/me/notification-preferences")
    fun put(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: NoticePreferencesRequest): NoticePreferencesResponse = notices.updatePreferences(member(jwt), request)
}
