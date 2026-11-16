package ai.storyfork.content.notice

import ai.storyfork.content.notice.entity.WorkNoticeEntity
import jakarta.persistence.Column
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** DB 없이 V36 SQL을 계약과 엔티티에 대조한다. 엔티티와 칼럼이 어긋나면 ddl-auto=validate 때문에 CI 통합 테스트 전체가 깨진다. */
class WorkNoticeSchemaTest {
    @Test fun `V36 keeps the contract index and the entity maps exactly its columns`() {
        val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V36__work_notice.sql"))
        val tables = sql.split("CREATE TABLE ").drop(1).associate { it.substringBefore(" (") to it }
        assertEquals(setOf("work_notice"), tables.keys)

        assertTrue(sql.contains("CREATE INDEX work_notice_work ON work_notice (work_id) WHERE deleted_at IS NULL"))
        val columns = Regex("^ {4}(\\w+) ", RegexOption.MULTILINE).findAll(tables.getValue("work_notice")).map { it.groupValues[1] }.toSet()
        val mapped = WorkNoticeEntity::class.java.declaredFields.mapNotNull { it.getAnnotation(Column::class.java)?.name }.toSet()
        assertEquals(columns, mapped)
    }
}
