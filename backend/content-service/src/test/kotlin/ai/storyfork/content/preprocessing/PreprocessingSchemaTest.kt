package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.config.ContentPersistenceConfig
import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import java.nio.file.Files
import java.nio.file.Path
import jakarta.persistence.Column
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 전처리 작업 테이블 계약(V41)이다. 엔티티와 칼럼이 어긋나면 ddl-auto=validate 때문에 CI 통합 테스트 전체가 깨지므로 DB 없이 이름을 대조한다. */
class PreprocessingSchemaTest {
    private val sql = Files.readString(Path.of("src/main/resources/db/migration/preprocessing/V41__manuscript_preprocessing_job.sql"))
    private val update = Files.readString(Path.of("src/main/resources/db/migration/preprocessing/V43__preprocessing_job_kind.sql"))

    @Test fun `the job table keeps the contract fields with a status check and one open or completed job per work`() {
        assertTrue(sql.contains("CREATE TABLE preprocessing_job ("))
        assertTrue(sql.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(sql.contains("member_id varchar(200) NOT NULL"))
        assertTrue(sql.contains("world_id uuid,"), "연결 세계관은 접수 때 없을 수 있다")
        assertFalse(Regex("world_id uuid[^,]*REFERENCES").containsMatchIn(sql), "worldstudio는 별도 Flyway 이력이라 FK를 두지 않는다")
        assertTrue(sql.contains("CHECK (status IN ('queued','running','loading','completed','failed'))"))
        assertTrue(sql.contains("failed_episodes integer[] NOT NULL DEFAULT '{}'"))
        assertTrue(sql.contains("CREATE UNIQUE INDEX preprocessing_job_one_per_work ON preprocessing_job (work_id) WHERE status IN ('queued','running','loading','completed');"),
            "같은 작품의 진행 중·완료 작업은 하나다. 동시 접수와 옛 작업 재실행의 마지막 방어다")
    }

    @Test fun `the update kind frees the completed initial job's slot and allows one open update job per work`() {
        assertTrue(update.contains("ALTER TABLE preprocessing_job ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','update'));"))
        assertTrue(update.contains("DROP INDEX preprocessing_job_one_per_work;"))
        assertTrue(update.contains("CREATE UNIQUE INDEX preprocessing_job_one_per_work ON preprocessing_job (work_id) WHERE kind='initial' AND status IN ('queued','running','loading','completed');"),
            "최초 구축은 이전처럼 작품당 진행 중·완료 하나다")
        assertTrue(update.contains("CREATE UNIQUE INDEX preprocessing_job_one_open_update_per_work ON preprocessing_job (work_id) WHERE kind='update' AND status IN ('queued','running','loading');"),
            "업데이트 작업은 완료된 최초 구축 옆에 접수되고 동시에는 하나만 진행한다")
    }

    @Test fun `the entity maps exactly the table columns`() {
        val table = Regex("CREATE TABLE preprocessing_job \\((.*?)\\n\\);", RegexOption.DOT_MATCHES_ALL).find(sql)!!.groupValues[1]
        val sqlColumns = table.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("--") }
            .map { it.substringBefore(' ') }.toSet()
        val entityColumns = PreprocessingJobEntity::class.java.declaredFields.mapNotNull { it.getAnnotation(Column::class.java)?.name }.toSet()
        val added = Regex("ADD COLUMN (\\w+)").findAll(update).map { it.groupValues[1] }.toSet()
        assertEquals(sqlColumns + added, entityColumns)
    }

    @Test fun `the migration leaf and the persistence packages are registered`() {
        assertTrue("classpath:db/migration/preprocessing" in ContentPersistenceConfig.MIGRATION_LOCATIONS)
        val config = Files.readString(Path.of("src/main/kotlin/ai/storyfork/content/_common/config/ContentPersistenceConfig.kt"))
        assertTrue(config.contains("\"ai.storyfork.content.preprocessing.repository\""), "JPA 저장소 스캔")
        assertTrue(config.contains("\"ai.storyfork.content.preprocessing.entity\""), "JPA 엔티티 스캔")
    }

    @Test fun `the progress path is served by the AI service token chain and the rest of the internal paths stay on the operations chain`() {
        val security = Files.readString(Path.of("src/main/kotlin/ai/storyfork/content/auth/config/ContentSecurityConfig.kt"))
        assertTrue(security.contains("securityMatcher(\"/internal/v1/ai/**\", \"/internal/v1/preprocessing-jobs/*/progress\")"))
        assertEquals(1, Regex("preprocessing-jobs").findAll(security).count(), "목록·재실행은 기존 /internal/v1/** 운영 체인을 그대로 쓴다")
    }
}
