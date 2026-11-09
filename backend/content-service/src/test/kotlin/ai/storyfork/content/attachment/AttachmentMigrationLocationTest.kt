package ai.storyfork.content.attachment

import ai.storyfork.content._common.config.ContentPersistenceConfig
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/** Discovery touches an H2 connection: integration classification, not a local pure-unit check. */
class AttachmentMigrationLocationTest {
    @Test fun `explicit content leaves exclude auth studio and independent attachment histories`() {
        val locations=ContentPersistenceConfig.MIGRATION_LOCATIONS
        assertFalse(locations.any {it.endsWith("/content") || it.endsWith("/auth") || it.endsWith("/worldstudio")})
        val migrations=Flyway.configure().dataSource("jdbc:h2:mem:attachment-discovery","sa","")
            .locations(*locations).table("content_schema_history").load().info().all()
        assertEquals((1..17).map(Int::toString),migrations.map {it.version.toString()})
        val attachments=Flyway.configure().dataSource("jdbc:h2:mem:attachment-discovery-other","sa","")
            .locations("classpath:db/migration/settingattachment").table("setting_attachment_schema_history").load().info().all()
        assertEquals(listOf("1"),attachments.map {it.version.toString()})
    }
}
