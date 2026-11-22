package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content.serial.config.SerialConfig
import ai.storyfork.content.serial.controller.SerialController
import ai.storyfork.content.serial.service.SerialRunner
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.context.annotation.Bean
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 앱을 띄우지 않고 공개 경로·상태 코드·스케줄러·보안 순서·등록 지점을 계약대로 고정한다. 어긋나면 화면이나 CI 통합 테스트가 한꺼번에 깨진다. */
class SerialWiringTest {
    private val main = Path.of("src/main/kotlin/ai/storyfork/content")

    private fun mappings() = SerialController::class.java.declaredMethods.mapNotNull { method ->
        AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping::class.java)?.let { Triple(it.method.single().name, it.path.single(), method.name) }
    }

    @Test fun `the controller serves exactly the contract paths under one work`() {
        assertEquals("/api/v1/works/{id}", AnnotatedElementUtils.findMergedAnnotation(SerialController::class.java, RequestMapping::class.java)!!.path.single())
        assertEquals(
            setOf(
                "GET /ai-serial", "PUT /ai-serial", "POST /ai-serial/run", "GET /ai-serial/boards", "GET /serial-board",
                "POST /serial-board/opinions", "PUT /serial-board/vote", "DELETE /serial-board/vote", "POST /serial-board/opinions/{opinionId}/hide",
            ),
            mappings().map { it.first + " " + it.second }.toSet(),
        )
        assertEquals(9, mappings().size)
    }

    @Test fun `the status codes follow the agreed wire contract`() {
        val status = SerialController::class.java.declaredMethods.associate { it.name to it.getAnnotation(ResponseStatus::class.java)?.value?.value() }
        assertEquals(202, status["run"])
        assertEquals(201, status["opinion"])
        assertEquals(204, status["vote"])
        assertEquals(204, status["cancelVote"])
        assertEquals(204, status["hide"])
        // 설정·기록·독자 게시판은 기본 200이다.
        for (name in listOf("settings", "save", "boards", "board")) assertNull(status[name], name)
    }

    @Test fun `one scheduled check runs every minute on its own scheduler`() {
        val scheduled = SerialRunner::class.java.declaredMethods.filter { it.getAnnotation(Scheduled::class.java) != null }
        assertEquals(listOf("tick"), scheduled.map { it.name })
        val annotation = scheduled.single().getAnnotation(Scheduled::class.java)
        assertEquals(60_000L, annotation.fixedDelay)
        assertEquals("serialScheduler", annotation.scheduler)
        assertEquals(0, scheduled.single().parameterCount)
        // @Bean의 value·name은 별칭이라 합성 애노테이션으로 읽는다.
        assertEquals(listOf("serialScheduler"), AnnotatedElementUtils.findMergedAnnotation(SerialConfig::class.java.getDeclaredMethod("serialScheduler"), Bean::class.java)!!.name.toList())
    }

    @Test fun `the reader board GET is anonymous before the authenticated works rule`() {
        val security = Files.readString(main.resolve("auth/config/ContentSecurityConfig.kt"))
        val open = security.indexOf("requestMatchers(HttpMethod.GET, \"/api/v1/works/*/serial-board\").permitAll()")
        val closed = security.indexOf("requestMatchers(\"/api/v1/works\", \"/api/v1/works/**\"")
        assertTrue(open in 0 until closed, "공개 GET 허용이 /works/** 인증 규칙보다 먼저여야 한다")
        // 읽기만 연다: 쓰기 경로는 어떤 permitAll에도 없다.
        assertEquals(1, Regex("serial-board").findAll(security).count())
    }

    @Test fun `the package is registered for persistence and for the shared error handler`() {
        val persistence = Files.readString(main.resolve("_common/config/ContentPersistenceConfig.kt"))
        assertTrue(persistence.contains("\"ai.storyfork.content.serial.repository\""))
        assertTrue(persistence.contains("\"ai.storyfork.content.serial.entity\""))
        assertTrue("ai.storyfork.content.serial.controller" in ContentExceptionHandler::class.java.getAnnotation(RestControllerAdvice::class.java).basePackages)
    }

    @Test fun `no setting proposal or world link requirement exists in the feature`() {
        val sources = Files.walk(main.resolve("serial")).use { paths -> paths.filter { it.toString().endsWith(".kt") }.map { Files.readString(it) }.toList() }
        assertTrue(sources.isNotEmpty())
        for (code in sources) {
            assertFalse(code.contains("WORLD_NOT_LINKED"))
            assertFalse(code.contains("setting-proposals"))
            assertFalse(code.contains("setting_status"))
        }
    }
}
