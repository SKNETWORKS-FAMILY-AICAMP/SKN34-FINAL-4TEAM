package ai.storyfork.content.world.migration

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WorldStudioMigrationPropertiesTest {
    private fun environment() = mutableMapOf(
        "WORLDSTUDIO_MIGRATION_ENVIRONMENT" to "development",
        "CONTENT_DATABASE_URL" to "jdbc:postgresql://qa:5432/studio?sslmode=require",
        "CONTENT_DATABASE_USER" to "qa",
        "CONTENT_DATABASE_PASSWORD" to "test-only",
        "WORLDSTUDIO_EXPECTED_DATABASE_URL" to "jdbc:postgresql://qa:5432/studio?sslmode=require",
        "WORLDSTUDIO_EXPECTED_DATABASE_USER" to "qa",
        "WORLDSTUDIO_BACKUP_RESTORE_REFERENCE" to "isolated-restore-proof",
    )

    @Test fun `accepts explicitly verified development target`() {
        assertEquals("studio", WorldStudioMigrationProperties.from(environment()).database)
    }

    @Test fun `legacy dedicated settings cannot redirect Core migration`() {
        val values=environment().apply {
            put("WORLDSTUDIO_DATABASE_URL","jdbc:postgresql://other:5432/other")
            put("WORLDSTUDIO_DATABASE_USER","other")
            put("WORLDSTUDIO_DATABASE_PASSWORD","other")
        }
        assertEquals(values["CONTENT_DATABASE_URL"],WorldStudioMigrationProperties.from(values).url)
        listOf("CONTENT_DATABASE_URL","CONTENT_DATABASE_USER","CONTENT_DATABASE_PASSWORD").forEach { key ->
            assertThrows(IllegalArgumentException::class.java) {
                WorldStudioMigrationProperties.from(values.toMutableMap().apply { remove(key) })
            }
        }
    }

    @Test fun `missing settings and wrong targets fail before connection`() {
        environment().keys.forEach { key ->
            assertThrows(IllegalArgumentException::class.java) {
                WorldStudioMigrationProperties.from(environment().apply { remove(key) })
            }
        }
        for ((key, value) in listOf(
            "WORLDSTUDIO_MIGRATION_ENVIRONMENT" to "production",
            "CONTENT_DATABASE_URL" to "jdbc:postgresql://other:5432/studio",
            "CONTENT_DATABASE_USER" to "other",
        )) {
            assertThrows(IllegalArgumentException::class.java) {
                WorldStudioMigrationProperties.from(environment().apply { put(key, value) })
            }
        }
    }

    @Test fun `rejects embedded credentials and non postgres connections`() {
        for (url in listOf("jdbc:h2:mem:test", "jdbc:postgresql://qa:secret@qa/studio",
            "jdbc:postgresql://qa/studio?password=secret", "jdbc:postgresql://qa/studio?USER=other")) {
            assertThrows(IllegalArgumentException::class.java) {
                WorldStudioMigrationProperties.from(environment().apply {
                    put("CONTENT_DATABASE_URL", url); put("WORLDSTUDIO_EXPECTED_DATABASE_URL", url)
                })
            }
        }
    }
}
