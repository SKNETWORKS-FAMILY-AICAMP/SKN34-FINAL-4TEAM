package ai.storyfork.content.world

import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import jakarta.persistence.Column
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 발행 회차 업데이트 작업(2026-11-22)의 V16 계약이다. 엔티티와 칼럼이 어긋나면 validate 때문에 CI 통합 테스트 전체가 깨지므로 DB 없이 이름을 대조한다. */
class ManuscriptBuildUpdateSchemaTest {
    private val v15 = Files.readString(Path.of("src/main/resources/db/migration/worldstudio/V15__manuscript_initial_build.sql"))
    private val v16 = Files.readString(Path.of("src/main/resources/db/migration/worldstudio/V16__manuscript_build_update.sql"))

    @Test fun `an update row is told apart by kind and its basis is kept apart from the fixed input`() {
        assertTrue(v16.contains("ALTER TABLE worldstudio.manuscript_build_job ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','update'));"))
        assertTrue(v16.contains("ALTER TABLE worldstudio.manuscript_build_job ADD COLUMN basis jsonb CHECK (basis IS NULL OR jsonb_typeof(basis)='object');"))
        // 불변 트리거가 비교하는 입력 칼럼에 basis가 들면 claim 때 기준 초안을 고정할 수 없다. manifest는 접수 때의 불변 입력으로 그대로 둔다.
        val guarded = Regex("\\(NEW\\.id,NEW\\.work_id[^)]*\\)").find(v15)!!.value
        assertFalse(guarded.contains("basis") || guarded.contains("kind"), guarded)
        assertTrue(v16.contains("manifest"), "기준 초안을 manifest에 다시 쓰지 않는 이유를 SQL 주석으로 남긴다")
    }

    @Test fun `the job entity maps the new columns`() {
        fun column(field: String) = ManuscriptBuildJob::class.java.getDeclaredField(field).getAnnotation(Column::class.java)
        assertEquals("kind", column("kind").name)
        assertEquals("basis", column("basis").name)
        assertEquals("jsonb", column("basis").columnDefinition)
    }
}
