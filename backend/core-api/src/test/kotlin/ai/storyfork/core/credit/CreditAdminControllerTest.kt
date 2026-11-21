package ai.storyfork.core.credit

import ai.storyfork.core.credit.controller.CreditAdminController
import ai.storyfork.core.credit.service.CreditAdminService
import ai.storyfork.core.credit.service.InvalidCreditAdjustmentException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.http.MediaType
import org.springframework.web.method.annotation.ExceptionHandlerMethodResolver

/** 운영자 크레딧 API의 오류 응답 모양(상태·코드)을 확인한다. 경로·보안·JSON 바인딩은 CreditAdminApiIntegrationTest가 맡는다. */
class CreditAdminControllerTest {
    private val controller = CreditAdminController(mock(CreditAdminService::class.java))

    @Test
    fun `a revoke above the balance is a 409 problem with its own code and no balance numbers`() {
        val response = controller.insufficient()

        assertEquals(409, response.statusCode.value())
        assertEquals(MediaType.APPLICATION_PROBLEM_JSON, response.headers.contentType)
        val problem = requireNotNull(response.body)
        assertEquals("CREDIT_INSUFFICIENT", problem.properties?.get("code"))
        assertEquals("회수할 수 있는 크레딧이 부족합니다.", problem.detail)
    }

    @Test
    fun `rule violations are 422 problems that carry the service message`() {
        val response = controller.invalid(InvalidCreditAdjustmentException("금액은 1 이상 100000 이하의 정수여야 합니다."))

        assertEquals(422, response.statusCode.value())
        assertEquals(MediaType.APPLICATION_PROBLEM_JSON, response.headers.contentType)
        val problem = requireNotNull(response.body)
        assertEquals("INVALID_CREDIT_REQUEST", problem.properties?.get("code"))
        assertEquals("금액은 1 이상 100000 이하의 정수여야 합니다.", problem.detail)
    }

    @Test
    fun `only the rule exception is a 422, so a framework IllegalArgumentException such as a malformed member id stays a 400`() {
        val handlers = ExceptionHandlerMethodResolver(CreditAdminController::class.java)

        assertNull(handlers.resolveMethodByThrowable(IllegalArgumentException("Invalid UUID string: abc")))
        assertEquals("invalid", handlers.resolveMethodByThrowable(InvalidCreditAdjustmentException("x"))?.name)
    }
}
