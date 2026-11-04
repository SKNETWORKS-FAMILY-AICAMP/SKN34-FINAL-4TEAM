package ai.storyfork.core.attachment

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.context.annotation.DependsOn

class AttachmentDependencyTest {
    @Test fun `attachment persistence waits for the current content persistence bean`() {
        val method=AttachmentConfig::class.java.declaredMethods.single { it.name=="attachmentEntityManagerFactory" }
        val names=method.getAnnotation(DependsOn::class.java).value.toList()
        assertTrue("contentEntityManagerFactory" in names)
        assertFalse("contentRepository" in names)
    }
}
