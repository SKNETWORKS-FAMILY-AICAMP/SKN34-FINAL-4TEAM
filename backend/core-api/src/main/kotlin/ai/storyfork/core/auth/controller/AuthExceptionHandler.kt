package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.AuthException
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

/**
 * 인증·회원 업무 실패를 기존과 같은 HTTP 상태로 변환한다.
 * 이용 제한 회원의 로그인(RESTRICTED)만 사유 코드 `ACCOUNT_RESTRICTED`를 담은 problem+json 본문을 반환하고,
 * 나머지는 기존 오류 처리와 동일하게 `sendError`로 상태만 보내며 null을 반환한다.
 */
@RestControllerAdvice(basePackages = ["ai.storyfork.core.auth.controller"])
class AuthExceptionHandler {
    @ExceptionHandler(AuthException::class)
    fun handle(exception: AuthException, response: HttpServletResponse): ResponseEntity<ProblemDetail>? {
        val status = status(exception.reason)
        if (exception.reason == AuthException.Reason.RESTRICTED) {
            val problem = ProblemDetail.forStatusAndDetail(status, "Account is restricted.")
            problem.setProperty("code", "ACCOUNT_RESTRICTED")
            return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(problem)
        }
        response.sendError(status.value())
        return null
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
