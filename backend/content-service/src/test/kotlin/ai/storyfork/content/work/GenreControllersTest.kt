package ai.storyfork.content.work

import ai.storyfork.content.work.controller.InternalGenreController
import ai.storyfork.content.work.controller.PublicGenreController
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.bind.annotation.ResponseStatus

/** 장르 API의 경로·메서드·상태 코드가 계약(DEC-56)과 같은지 어노테이션으로 확인한다(HTTP 없이). */
class GenreControllersTest {
    private fun route(type: Class<*>, name: String): Triple<String, List<RequestMethod>, HttpStatus?> {
        val method = type.methods.single { it.name == name }
        val base = AnnotatedElementUtils.findMergedAnnotation(type, RequestMapping::class.java)!!.path.singleOrNull().orEmpty()
        val mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping::class.java)!!
        return Triple(base + mapping.path.singleOrNull().orEmpty(), mapping.method.toList(), AnnotatedElementUtils.findMergedAnnotation(method, ResponseStatus::class.java)?.code)
    }

    @Test fun `the public list is a GET with nothing after the collection path`() {
        assertEquals(Triple("/api/v1/public/genres", listOf(RequestMethod.GET), null), route(PublicGenreController::class.java, "list"))
    }

    @Test fun `the internal API keeps the contract paths methods and statuses`() {
        val internal = InternalGenreController::class.java
        assertEquals(Triple("/internal/v1/genres", listOf(RequestMethod.GET), null), route(internal, "list"))
        assertEquals(Triple("/internal/v1/genres", listOf(RequestMethod.POST), HttpStatus.CREATED), route(internal, "create"))
        assertEquals(Triple("/internal/v1/genres/{code}", listOf(RequestMethod.PATCH), null), route(internal, "update"))
        assertEquals(Triple("/internal/v1/genres/order", listOf(RequestMethod.PUT), null), route(internal, "reorder"))
    }

    @Test fun `the public list is open to anonymous GET and the internal paths stay on the operations token chain`() {
        val security = Files.readString(Path.of("src/main/kotlin/ai/storyfork/content/auth/config/ContentSecurityConfig.kt"))
        assertTrue(Regex("requestMatchers\\(HttpMethod.GET,[^)]*\"/api/v1/public/genres\"").containsMatchIn(security))
        assertFalse(security.contains("/internal/v1/genres"), "내부 장르 API는 기존 /internal/v1/** 운영 체인이 그대로 덮는다")
    }
}
