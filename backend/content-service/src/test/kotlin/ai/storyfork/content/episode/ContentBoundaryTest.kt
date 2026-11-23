package ai.storyfork.content.episode

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** #84: ownership boundaries must hold even when no PostgreSQL server is available. */
class ContentBoundaryTest {
    private val root = Path.of("src/main/kotlin/ai/storyfork/content")
    private val features = listOf("episode", "episode_version", "work", "world", "fork", "publication", "proposal", "context", "like", "reading", "feedbackreport", "editsuggestion", "notice", "preprocessing", "serial")

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
        // V1 시드는 30개 장르 이름이며 이후 DEC-56(V42)이 운영 화면에서 바꾸는 정본으로 넘긴다(하드코딩 목록은 더 두지 않는다).
        assertEquals(listOf(
        "판타지", "현대판타지", "무협", "선협", "퓨전", "로맨스", "로맨스판타지", "BL", "GL", "현대",
        "시대물", "역사", "대체역사", "SF", "게임", "스포츠", "드라마", "미스터리", "추리", "스릴러",
        "공포", "오컬트", "액션", "전쟁·밀리터리", "라이트노벨", "학원", "일상", "고전", "일반소설", "기타",
    ), genres)
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

    @Test fun `edit suggestion package is registered for JPA scanning and the content exception handler`() {
        val config = Files.readString(root.resolve("_common/config/ContentPersistenceConfig.kt"))
        assertTrue(config.contains("\"ai.storyfork.content.editsuggestion.repository\""))
        assertTrue(config.contains("\"ai.storyfork.content.editsuggestion.entity\""))
        assertTrue(Files.readString(root.resolve("_common/exception/ContentExceptionHandler.kt")).contains("\"ai.storyfork.content.editsuggestion.controller\""))
    }

    @Test fun `notice package is registered for JPA scanning and the content exception handler`() {
        val config = Files.readString(root.resolve("_common/config/ContentPersistenceConfig.kt"))
        assertTrue(config.contains("\"ai.storyfork.content.notice.repository\""))
        assertTrue(config.contains("\"ai.storyfork.content.notice.entity\""))
        assertTrue(Files.readString(root.resolve("_common/exception/ContentExceptionHandler.kt")).contains("\"ai.storyfork.content.notice.controller\""))
    }

    @Test fun `writing ai failures become their own http status through the content exception handler`() {
        assertTrue(Files.readString(root.resolve("_common/exception/ContentExceptionHandler.kt")).contains("\"ai.storyfork.content.writingai.controller\""))
    }

    @Test fun `edit suggestion table follows the contract and keeps the report link free of foreign keys for now`() {
        val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V29__edit_suggestion.sql"))
        val tables = sql.split("CREATE TABLE ").drop(1).associate { it.substringBefore(" (") to it }
        assertEquals(setOf("edit_suggestion"), tables.keys)
        val table = tables.getValue("edit_suggestion")
        assertTrue(table.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(table.contains("published_version_id varchar(36) NOT NULL REFERENCES episode_version(id)"))
        assertTrue(table.contains("applied_version_id varchar(36) REFERENCES episode_version(id)"))
        assertTrue(table.contains("source text NOT NULL CHECK (source IN ('reader','ai'))"))
        assertTrue(table.contains("status text NOT NULL CHECK (status IN ('pending','approved','rejected','held'))"))
        assertTrue(table.contains("apply_result text CHECK (apply_result IN ('applied','failed'))"))
        // report_id는 제보 연결(계약 3절)용 칸이라 이 슬라이스에서는 FK 없이 둔다. 작성자·제안자 표시명은 저장하지 않는다.
        assertTrue(table.contains("report_id varchar(36),"))
        assertFalse(table.contains("proposer_name"))
        assertTrue(sql.contains("CREATE INDEX edit_suggestion_work ON edit_suggestion (work_id, created_at DESC)"))
        assertTrue(sql.contains("CREATE INDEX edit_suggestion_proposer ON edit_suggestion (proposer_id, created_at DESC)"))
    }

    @Test fun `work world studio link is one nullable unique uuid column that the work entity maps`() {
        // 엔티티와 칼럼이 어긋나면 ddl-auto=validate 때문에 CI 통합 테스트 전체가 깨진다. UNIQUE가 세계관-소설 1:1(DEC-46)의 최종 방어다.
        val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V37__work_world_studio.sql"))
        assertTrue(sql.contains("ALTER TABLE work ADD COLUMN world_studio_id uuid UNIQUE;"))
        assertFalse(sql.contains("REFERENCES"), "worldstudio는 별도 Flyway 이력이라 FK를 두지 않는다")
        val field = ai.storyfork.content.work.entity.WorkEntity::class.java.getDeclaredField("worldStudioId")
        assertEquals("world_studio_id", field.getAnnotation(jakarta.persistence.Column::class.java).name)
        assertEquals(java.util.UUID::class.java, field.type)
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
        // Development samples share the global order (sample/V16); V17 comments, V18 likes, V19 interests/outbox, V20 reading_record, V21 work soft delete, V22 publication visibility, V23 author notes (episode leaf), V25 publication schedule (publication leaf), V26 world checkpoint (world leaf), V27 episode world basis (episode leaf), V28 feedback reports (work leaf), V29 edit suggestions (work leaf), V30 episode_comment.hidden (work leaf), V31 episode soft delete (episode leaf), V36 work notices (work leaf; V32~V35 belong to other open PRs), V37 work.world_studio_id (work leaf, the 1:1 WorldStudio link of DEC-46).
        // V24 stays vacant: V25 reached the shared DB first and Flyway runs without outOfOrder, so a lower version could never be applied there.
        // V38 adds scene positions, V39 records author handling time, V40 adds work operating settings history,
        // V41 adds the manuscript preprocessing job table in its own preprocessing leaf (#343, DEC-50),
        // V42 adds genre management columns to the V1 genre table (active·position·featured·emoji, UNIQUE name; DEC-56),
        // V43 adds the preprocessing job kind (initial|update) so a completed initial build and its update jobs can coexist (preprocessing leaf),
        // V44 adds the AI serial tables (settings, boards, choices, proposals, votes, summaries; work leaf, #659),
        // V45 adds the autonomous writing mode to the V40 work_automation_version CHECK (work leaf, #659),
        // V46 adds the operator's episode restriction (episode leaf), and V47 adds image generation jobs (proposal leaf, #332).
        assertEquals((1..23) + (25..31) + (36..47), versions.sorted())
        assertTrue(leaves.contains("classpath:db/migration/sample"))
        assertFalse(Files.readString(Path.of("src/main/kotlin/ai/storyfork/content/_common/config/ContentPersistenceConfig.kt")).contains("outOfOrder"))
        Files.list(migration).use { paths ->
            assertFalse(paths.anyMatch { it.toString().endsWith(".sql") }, "Unscoped Flyway SQL")
        }
    }
}
