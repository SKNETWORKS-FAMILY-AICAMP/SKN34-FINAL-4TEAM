package ai.storyfork.operations._common

import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.inquiry.service.dto.InquiryReplyRequest
import ai.storyfork.operations.inquiry.service.dto.InquiryRequest
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import jakarta.validation.Validation
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** 길이 규칙의 유일한 출처는 요청 DTO 어노테이션이다. 공백은 서비스도 `isNotBlank`로 다시 검사한다(`@NotBlank`는 NBSP류를 통과시킨다, `blankTexts`). */
class RequestValidationTest {
    private val validator = Validation.buildDefaultValidatorFactory().validator
    private val notice = NoticeRequest("제목", "본문")
    private val event = EventRequest("제목", "본문")
    private val inquiry = InquiryRequest("제목", "본문", "분류")
    private val reply = InquiryReplyRequest("본문")

    private fun violatedFields(request: Any) = validator.validate(request).map { it.propertyPath.toString() }.sorted()

    private fun rejected(limit: Int) = listOf("", " \t\n", "x".repeat(limit + 1))

    @Test
    fun `blank and over long values are rejected on every request field`() {
        val cases = buildList {
            for (value in rejected(200)) {
                add(notice.copy(title = value) to "title")
                add(event.copy(title = value) to "title")
                add(inquiry.copy(title = value) to "title")
            }
            for (value in rejected(20_000)) {
                add(notice.copy(body = value) to "body")
                add(event.copy(body = value) to "body")
                add(inquiry.copy(body = value) to "body")
                add(reply.copy(body = value) to "body")
            }
            for (value in rejected(50)) add(inquiry.copy(category = value) to "category")
        }

        for ((request, field) in cases) assertEquals(listOf(field), violatedFields(request), request.toString())
    }

    @Test
    fun `values at the exact limits are accepted`() {
        val title = "가".repeat(200)
        val body = "나".repeat(20_000)

        for (request in listOf(NoticeRequest(title, body), EventRequest(title, body), InquiryRequest(title, body, "분".repeat(50)),
            InquiryReplyRequest(body))) {
            assertEquals(emptyList<String>(), violatedFields(request), request.javaClass.simpleName)
        }
    }
}
