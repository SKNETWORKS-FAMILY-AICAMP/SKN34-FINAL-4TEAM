package ai.storyfork.content.work

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** DB 없이 V44 SQL을 계약에 대조한다: 집필 방식 CHECK에 autonomous만 더하고 이력 표·불변성 트리거는 건드리지 않는다(AI 자율 집필 = 집필 방식, #659). */
class WorkAutonomousModeMigrationTest {
    private val v40 = Files.readString(Path.of("src/main/resources/db/migration/work/V40__work_automation_version.sql"))
    private val v44 = Files.readString(Path.of("src/main/resources/db/migration/work/V44__autonomous_writing_mode.sql"))

    @Test fun `V44 replaces the writing mode check with direct assisted and autonomous`() {
        // V40의 열 CHECK는 Postgres가 <표>_<열>_check로 이름 붙인다. 같은 이름을 지우고 세 값으로 다시 만든다.
        assertTrue(v40.contains("writing_mode text NOT NULL CHECK (writing_mode IN ('direct', 'assisted'))"))
        assertTrue(v44.contains("DROP CONSTRAINT work_automation_version_writing_mode_check"))
        assertTrue(v44.contains("ADD CONSTRAINT work_automation_version_writing_mode_check"))
        assertTrue(v44.contains("CHECK (writing_mode IN ('direct', 'assisted', 'autonomous'))"))
    }

    @Test fun `V44 touches nothing but that constraint`() {
        val statements = v44.lines().filter { !it.trim().startsWith("--") }.joinToString(" ").split(";").map { it.trim() }.filter { it.isNotEmpty() }

        assertEquals(2, statements.size)
        assertTrue(statements.all { it.startsWith("ALTER TABLE work_automation_version ") }, statements.toString())
        assertFalse(v44.contains("CREATE TABLE") || v44.contains("DROP TABLE") || v44.contains("TRIGGER") || v44.contains("INSERT") || v44.contains("UPDATE "))
    }
}
