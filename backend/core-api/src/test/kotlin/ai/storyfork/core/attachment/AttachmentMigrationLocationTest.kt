package ai.storyfork.core.attachment

import java.util.Properties
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AttachmentMigrationLocationTest {
    @Test fun `auth discovery excludes independent attachment migration versions`() {
        val properties = Properties().apply {
            AttachmentMigrationLocationTest::class.java.getResourceAsStream("/application.properties")!!.use { load(it) }
        }
        val location = properties.getProperty("spring.flyway.locations", "classpath:db/migration")
        val migrations = Flyway.configure().dataSource("jdbc:h2:mem:attachment-discovery", "sa", "")
            .locations(location).load().info().all()
        assertEquals(listOf("1", "2", "3"), migrations.map { it.version.toString() })
        val attachments = Flyway.configure().dataSource("jdbc:h2:mem:attachment-discovery-other", "sa", "")
            .locations("classpath:db/migration/settingattachment").table("setting_attachment_schema_history").load().info().all()
        assertEquals(listOf("1"), attachments.map { it.version.toString() })
    }
}
