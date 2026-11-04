package ai.storyfork.content.world

import ai.storyfork.content._common.config.ContentPersistenceConfig
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

class WorldPersistenceBoundaryTest {
    @Test fun `studio entities stay outside content entity scan and use their own schema`() {
        val content = ai.storyfork.content.world.entity.WorldEntity::class.java
        val studio = ai.storyfork.content.world.studio.entity.StudioWorld::class.java
        assertFalse(studio.packageName.startsWith(content.packageName + ".") || studio.packageName == content.packageName)
        assertEquals("worldstudio", studio.getAnnotation(jakarta.persistence.Table::class.java).schema)
        assertEquals("", content.getAnnotation(jakarta.persistence.Table::class.java).schema)
    }

    @Test fun `content and studio repository scans never overlap`() {
        val content = ContentPersistenceConfig::class.java.getAnnotation(EnableJpaRepositories::class.java).basePackages
        val studio = WorldStudioConfig::class.java.getAnnotation(EnableJpaRepositories::class.java).basePackages
        for (left in content) for (right in studio) {
            assertFalse(left == right || left.startsWith("$right.") || right.startsWith("$left."), "$left overlaps $right")
        }
    }
}
