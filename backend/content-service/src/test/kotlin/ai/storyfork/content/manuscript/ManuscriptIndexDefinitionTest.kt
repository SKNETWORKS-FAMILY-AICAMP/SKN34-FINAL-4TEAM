package ai.storyfork.content.manuscript

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.core.io.ClassPathResource
import tools.jackson.databind.json.JsonMapper

class ManuscriptIndexDefinitionTest {
    @Test
    fun `Content가 만드는 매핑은 인프라 문서의 v1 매핑과 같다`() {
        val mapper = JsonMapper.builder().build()
        val bundled = ClassPathResource("manuscript/manuscript-chunks-v1.json").getContentAsString(Charsets.UTF_8)
        val documented = Files.readString(Path.of("../../infrastructure/elasticsearch/manuscript-chunks-v1.json"))
        assertEquals(mapper.readTree(documented), mapper.readTree(bundled))
    }
}
