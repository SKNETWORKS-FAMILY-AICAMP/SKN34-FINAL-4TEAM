package ai.storyfork.content.manuscript

import ai.storyfork.content.context.controller.ManuscriptQaController
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.manuscript.config.ManuscriptIndexConfig
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean

/**
 * 원고 색인은 어느 환경에서나 켜져 있다(2026-11-22 사용자 결정, MANUSCRIPT_INDEX_ENABLED 없음). 설정 클래스가 조건 없이 색인 클라이언트·대조 작업·검색 서비스를 만들고
 * 컨트롤러에 '사용할 수 없음' 분기가 없으며 설정 파일·소스가 옛 플래그를 읽지 않는다는 것을 DB·Elasticsearch 없이 고정한다.
 */
class ManuscriptIndexAlwaysOnTest {
    private val main = Path.of("src/main")

    @Test fun `the index configuration has no condition and always builds the index client the job and the search service`() {
        assertNull(ManuscriptIndexConfig::class.java.getAnnotation(ConditionalOnProperty::class.java))
        val beans = ManuscriptIndexConfig::class.java.declaredMethods.filter { it.isAnnotationPresent(Bean::class.java) }
        assertTrue(beans.none { it.isAnnotationPresent(ConditionalOnProperty::class.java) })
        assertEquals(setOf("scheduler", "manuscriptElasticsearch", "manuscriptEmbeddingClient", "manuscriptIndexJob", "manuscriptQaService"), beans.map { it.name }.toSet())
    }

    @Test fun `the retrieval controller takes the search service directly with no off switch`() {
        val constructor = ManuscriptQaController::class.java.declaredConstructors.single()

        assertEquals(listOf<Class<*>>(ManuscriptQaService::class.java), constructor.parameterTypes.toList())
    }

    @Test fun `no source or property file reads the old index flag anymore`() {
        val files = Files.walk(main).use { paths -> paths.filter { Files.isRegularFile(it) && (it.toString().endsWith(".kt") || it.toString().endsWith(".properties")) }.toList() }
        assertTrue(files.isNotEmpty())
        for (file in files) {
            val text = Files.readString(file)
            assertFalse(text.contains("MANUSCRIPT_INDEX_ENABLED") || text.contains("app.manuscript-index.enabled"), file.toString())
        }
        assertFalse(Files.readString(main.resolve("kotlin/ai/storyfork/content/context/controller/ManuscriptQaController.kt")).contains("MANUSCRIPT_QA_UNAVAILABLE"))
    }
}
