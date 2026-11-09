package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.AuthException
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 인증·회원 업무 실패를 기존과 같은 HTTP 상태로 변환한다. 응답 본문은 기존 오류 처리와 동일하게 상태만 보낸다. */
@RestControllerAdvice(basePackages = ["ai.storyfork.core.auth.controller"])
class AuthExceptionHandler {
    @ExceptionHandler(AuthException::class)
    fun handle(exception: AuthException, response: HttpServletResponse) {
        response.sendError(status(exception.reason).value())
    }

    private fun status(reason: AuthException.Reason): HttpStatus = when (reason) {
        AuthException.Reason.INVALID -> HttpStatus.BAD_REQUEST
        AuthException.Reason.UNAUTHENTICATED -> HttpStatus.UNAUTHORIZED
        AuthException.Reason.FORBIDDEN, AuthException.Reason.RESTRICTED -> HttpStatus.FORBIDDEN
        AuthException.Reason.NOT_FOUND -> HttpStatus.NOT_FOUND
        AuthException.Reason.CONFLICT -> HttpStatus.CONFLICT
        AuthException.Reason.UNAVAILABLE -> HttpStatus.SERVICE_UNAVAILABLE
    }
}
