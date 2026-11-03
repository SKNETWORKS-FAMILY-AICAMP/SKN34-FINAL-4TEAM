package ai.storyfork.core.episode

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** #84: ownership boundaries must hold even when no PostgreSQL server is available. */
class ContentBoundaryTest {
    private val root = Path.of("src/main/kotlin/ai/storyfork/core")
    private val features = listOf("episode", "episode_version", "work", "world", "fork", "publication", "proposal", "context")

    @Test fun `content HTTP resources have distinct controllers without raw servlet arguments`() {
        val controllers = mapOf(
            "episode" to "EpisodeController", "episode_version" to "EpisodeVersionController",
            "work" to "WorkController", "world" to "WorldController", "fork" to "ForkController",
            "publication" to "PublicationController", "proposal" to "ProposalController", "context" to "ContextController",
        )
        controllers.forEach { (feature, name) ->
            val path = root.resolve("$feature/controller/$name.kt")
            assertTrue(Files.exists(path), "Missing resource controller: $path")
            val source = Files.readString(path)
            assertFalse(Regex("HttpServletRequest|HttpServletResponse|WebRequest").containsMatchIn(source), path.toString())
        }
        assertFalse(Files.exists(root.resolve("content/controller/ContentController.kt")))
    }

    @Test fun `runtime content persistence is JPA and SQL remains only in historical import`() {
        val forbidden = Regex("JdbcTemplate|nativeQuery\\s*=\\s*true|pg_advisory_xact_lock")
        features.forEach { feature ->
            val folder = root.resolve(feature)
            assertTrue(Files.exists(folder), "Missing feature: $feature")
            Files.walk(folder).use { paths ->
                paths.filter { it.toString().endsWith(".kt") }.forEach { path ->
                    assertFalse(forbidden.containsMatchIn(Files.readString(path)), "Runtime SQL: $path")
                }
            }
        }
        assertFalse(Files.exists(root.resolve("content/repository/ContentRepository.kt")))
        assertTrue(Files.exists(root.resolve("content/migration/V5__ImportLegacyContent.kt")))
    }

    @Test fun `episode list keeps the existing JSON array and deletion remains deferred`() {
        val mapper=tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        val dto=ai.storyfork.core.episode.service.dto.EpisodeListResponse(listOf(
            ai.storyfork.core.episode.service.dto.EpisodeResponse(1,ai.storyfork.core.episode.service.dto.DraftResponse("제목","원고",2),emptyList(),null,false,null)))
        val value=mapper.readTree(mapper.writeValueAsString(dto))
        assertTrue(value.isArray)
        assertEquals("원고",value[0].path("draft").path("body").asText())
        assertEquals(2,value[0].path("draft").path("revision").asInt())
        assertEquals("content_only",value[0].path("checkpointStatus").asText())
        assertFalse(Files.readString(root.resolve("episode/controller/EpisodeController.kt")).contains("@DeleteMapping"))
    }

    @Test fun `historical SQL lives in explicit domain locations without deleting versions`() {
        val migration = Path.of("src/main/resources/db/migration")
        assertTrue(Files.exists(migration.resolve("auth/V1__auth_signup.sql")))
        assertTrue(Files.exists(migration.resolve("content/V1__content_work.sql")))
        assertTrue(Files.exists(migration.resolve("content/V8__validate_setting_visibility_range.sql")))
        Files.list(migration).use { paths ->
            assertFalse(paths.anyMatch { it.toString().endsWith(".sql") }, "Unscoped Flyway SQL")
        }
    }
}
