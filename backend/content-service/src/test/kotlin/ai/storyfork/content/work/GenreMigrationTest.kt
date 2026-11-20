package ai.storyfork.content.work

import ai.storyfork.content.work.entity.GenreEntity
import jakarta.persistence.Column
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 장르 관리(DEC-56) V42 SQL 계약이다. 엔티티와 칼럼이 어긋나면 ddl-auto=validate 때문에 CI 통합 테스트 전체가 깨지므로 DB 없이 이름을 대조한다. */
class GenreMigrationTest {
    private val v42 = Files.readString(Path.of("src/main/resources/db/migration/work/V42__genre_management.sql"))
    private val v1 = Files.readString(Path.of("src/main/resources/db/migration/work/V1__work.sql"))

    @Test fun `V42 adds the management columns and a unique name to the genre table`() {
        assertTrue(v42.contains("ALTER TABLE genre ADD COLUMN active boolean NOT NULL DEFAULT true;"))
        assertTrue(v42.contains("ALTER TABLE genre ADD COLUMN position integer NOT NULL DEFAULT 0;"))
        assertTrue(v42.contains("ALTER TABLE genre ADD COLUMN featured boolean NOT NULL DEFAULT false;"))
        assertTrue(v42.contains("ALTER TABLE genre ADD COLUMN emoji text;"), "아이콘은 선택이라 NULL을 허용한다")
        assertTrue(v42.contains("ALTER TABLE genre ADD CONSTRAINT genre_name_unique UNIQUE (name);"), "같은 이름 두 개를 DB가 막는다")
        assertTrue(v42.contains("ALTER TABLE genre ALTER COLUMN position DROP DEFAULT;"), "새 행의 순서는 서비스가 정한다")
    }

    @Test fun `the entity maps the V1 columns plus exactly the V42 columns`() {
        val sqlColumns = setOf("id", "code", "name") + Regex("ADD COLUMN (\\w+)").findAll(v42).map { it.groupValues[1] }
        val entityColumns = GenreEntity::class.java.declaredFields.mapNotNull { it.getAnnotation(Column::class.java)?.name }.toSet()
        assertEquals(sqlColumns, entityColumns)
    }

    @Test fun `existing rows are ordered by code and the three old home chips stay featured with their icons`() {
        assertTrue(v42.contains("UPDATE genre SET position = (SELECT count(*) FROM genre other WHERE other.code <= genre.code);"), "코드 순(genre-01=1 …)")
        val names = Regex("\\('(genre-\\d+)', 'genre-\\d+', '([^']+)'\\)").findAll(v1).associate { it.groupValues[1] to it.groupValues[2] }
        // 기존 고정 칩: 판타지·SF·고전. 아이콘은 ✨(U+2728)·🛰(U+1F6F0)·📜(U+1F4DC)이다.
        for ((code, name, emoji) in listOf(Triple("genre-01", "판타지", "\u2728"), Triple("genre-14", "SF", "\uD83D\uDEF0"), Triple("genre-28", "고전", "\uD83D\uDCDC"))) {
            assertEquals(name, names[code])
            assertTrue(v42.contains("UPDATE genre SET featured = true, emoji = '$emoji' WHERE code = '$code';"), code)
        }
        assertEquals(3, Regex("SET featured = true").findAll(v42).count(), "홈 노출은 세 장르뿐이다")
    }
}
