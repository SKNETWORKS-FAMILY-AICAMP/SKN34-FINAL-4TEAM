package ai.storyfork.core.notification.controller

import ai.storyfork.core.notification.service.PushDeviceService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

data class RegisterPushDeviceRequest(
    val installationId: UUID,
    val sessionId: UUID,
    @field:Pattern(regexp = "android") val platform: String,
    @field:NotBlank @field:Size(max = 4096) val token: String,
)

/** 웹 세션으로 인증한 Android 설치의 FCM 토큰을 등록하고 해제한다. */
@RestController
@RequestMapping("/api/v1/me/push-devices")
class PushDeviceController(private val devices: PushDeviceService) {
    /** 갱신된 토큰은 기존 설치의 토큰을 교체한다. */
    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun register(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody body: RegisterPushDeviceRequest) =
        devices.register(member(jwt), body.sessionId, body.installationId, body.token)

    /** 알림 권한이 꺼진 설치를 해제한다. 이미 해제된 경우도 204다. */
    @DeleteMapping("/{installationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@AuthenticationPrincipal jwt: Jwt, @PathVariable installationId: UUID) =
        devices.remove(member(jwt), installationId)

    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) }
    catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }
}
