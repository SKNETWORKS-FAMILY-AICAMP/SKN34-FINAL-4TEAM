package ai.storyfork.content.episode

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** #84: ownership boundaries must hold even when no PostgreSQL server is available. */
class ContentBoundaryTest {
    private val root = Path.of("src/main/kotlin/ai/storyfork/content")
    private val features = listOf("episode", "episode_version", "work", "world", "fork", "publication", "proposal", "context", "like", "reading")

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

    @Test fun `runtime content persistence is JPA without a legacy import fallback`() {
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
        assertFalse(Files.exists(root.resolve("migration")))
    }

    @Test fun `episode list keeps the existing JSON array and deletion endpoints preserve resource boundaries`() {
        val mapper=tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        val dto=ai.storyfork.content.episode.service.dto.EpisodeListResponse(listOf(
            ai.storyfork.content.episode.service.dto.EpisodeResponse(1,ai.storyfork.content.episode.service.dto.DraftResponse("제목","원고",2),emptyList(),null,false,null,
                checkpoints=listOf(ai.storyfork.content.episode.service.dto.EpisodeCheckpointResponse("v1","2026-11-01T00:00:00Z",true)))))
        val value=mapper.readTree(mapper.writeValueAsString(dto))
        assertTrue(value.isArray)
        assertEquals("원고",value[0].path("draft").path("body").asText())
        assertEquals(2,value[0].path("draft").path("revision").asInt())
        assertEquals("content_only",value[0].path("checkpointStatus").asText())
        val checkpoint=value[0].path("checkpoints")[0]
        assertEquals(listOf("v1","2026-11-01T00:00:00Z",true),listOf(checkpoint.path("versionId").asText(),checkpoint.path("publishedAt").asText(),checkpoint.path("active").asBoolean()))
        assertTrue(Files.readString(root.resolve("episode/controller/EpisodeController.kt")).contains("@DeleteMapping"))
    }

    @Test fun `work registration metadata belongs to the fresh content schema`() {
        val migration = Path.of("src/main/resources/db/migration")
        val work = Files.readString(migration.resolve("work/V1__work.sql"))
        assertTrue(work.contains("creation_type text NOT NULL DEFAULT 'original'"))
        assertTrue(work.contains("'external_derivative'"))
        val genres = Regex("\\('genre-\\d+', 'genre-\\d+', '([^']+)'\\)").findAll(work).map { it.groupValues[1] }.toList()
        assertEquals(ai.storyfork.content.work.domain.WORK_GENRES, genres)
        assertTrue(work.contains("CREATE TABLE work_hashtag"))
        assertTrue(work.contains("UNIQUE (work_id, position)"))
        assertTrue(work.contains("member_id varchar(200) NOT NULL REFERENCES member(id)"))
        assertFalse(Files.exists(Path.of("../core-api/src/main/kotlin/ai/storyfork/core/work")))
        assertFalse(Files.exists(Path.of("../core-api/src/main/resources/db/migration/content")))
    }

    @Test fun `work view table follows the search ranking contract`() {
        val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V14__work_view.sql"))
        assertTrue(sql.contains("CREATE TABLE work_view"))
        assertTrue(sql.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(sql.contains("episode_number integer NOT NULL CHECK (episode_number > 0)"))
        assertTrue(sql.contains("member_id varchar(200) NOT NULL"))
        assertTrue(sql.contains("view_date date NOT NULL"))
        assertTrue(sql.contains("viewed_at timestamptz NOT NULL DEFAULT now()"))
        assertTrue(sql.contains("PRIMARY KEY (work_id, episode_number, member_id, view_date)"))
        assertTrue(sql.contains("CREATE INDEX work_view_viewed_at ON work_view (viewed_at)"))
    }

    @Test fun `work like table follows the reading management contract`() {
        val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V18__work_like.sql"))
        assertTrue(sql.contains("CREATE TABLE work_like"))
        assertTrue(sql.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(sql.contains("member_id varchar(200) NOT NULL"))
        assertTrue(sql.contains("created_at timestamptz NOT NULL DEFAULT now()"))
        assertTrue(sql.contains("PRIMARY KEY (work_id, member_id)"))
    }

    @Test fun `reading tables follow the reading management contract`() {
        val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V20__reading_record.sql"))
        val tables = sql.split("CREATE TABLE ").drop(1).associate { it.substringBefore(" (") to it }
        assertEquals(setOf("reading_record", "reading_episode"), tables.keys)
        val record = tables.getValue("reading_record")
        assertTrue(record.contains("member_id varchar(200) NOT NULL"))
        assertTrue(record.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(record.contains("last_episode integer NOT NULL CHECK (last_episode > 0)"))
        assertTrue(record.contains("updated_at timestamptz NOT NULL DEFAULT now()"))
        assertTrue(record.contains("PRIMARY KEY (member_id, work_id)"))
        val episode = tables.getValue("reading_episode")
        assertTrue(episode.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(episode.contains("episode_number integer NOT NULL CHECK (episode_number > 0)"))
        assertTrue(episode.contains("read_at timestamptz NOT NULL DEFAULT now()"))
        assertTrue(episode.contains("PRIMARY KEY (member_id, work_id, episode_number)"))
    }

    @Test fun `reading package is registered for JPA scanning and the content exception handler`() {
        val config = Files.readString(root.resolve("_common/config/ContentPersistenceConfig.kt"))
        assertTrue(config.contains("\"ai.storyfork.content.reading.repository\""))
        assertTrue(config.contains("\"ai.storyfork.content.reading.entity\""))
        assertTrue(Files.readString(root.resolve("_common/exception/ContentExceptionHandler.kt")).contains("\"ai.storyfork.content.reading.controller\""))
    }

    @Test fun `fresh SQL lives in feature leaves with one global version order`() {
        val migration = Path.of("src/main/resources/db/migration")
        assertFalse(Files.exists(migration.resolve("auth")))
        assertFalse(Files.exists(migration.resolve("content")))
        val leaves = ai.storyfork.content._common.config.ContentPersistenceConfig.MIGRATION_LOCATIONS
        val versions = leaves.flatMap { location ->
            Files.list(migration.resolve(location.substringAfterLast('/'))).use { paths ->
                paths.filter { it.toString().endsWith(".sql") }
                    .map { Regex("V(\\d+)__.*").matchEntire(it.fileName.toString())!!.groupValues[1].toInt() }.toList()
            }
        }
        // Development samples share the global order (sample/V16); V17 comments, V18 likes, V19 interests/outbox, V20 reading_record, V21 work soft delete, V22 publication visibility, V23 author notes (episode leaf), V25 publication schedule (publication leaf), V26 world checkpoint (world leaf), V27 episode world basis (episode leaf).
        // V24 stays vacant: V25 reached the shared DB first and Flyway runs without outOfOrder, so a lower version could never be applied there.
        assertEquals((1..23).toList() + listOf(25, 26, 27), versions.sorted())
        assertTrue(leaves.contains("classpath:db/migration/sample"))
        assertFalse(Files.readString(Path.of("src/main/kotlin/ai/storyfork/content/_common/config/ContentPersistenceConfig.kt")).contains("outOfOrder"))
        Files.list(migration).use { paths ->
            assertFalse(paths.anyMatch { it.toString().endsWith(".sql") }, "Unscoped Flyway SQL")
        }
    }
}
