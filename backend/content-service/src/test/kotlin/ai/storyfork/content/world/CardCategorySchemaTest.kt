package ai.storyfork.content.world

import ai.storyfork.content.world.domain.DEFAULT_CARD_TYPES
import ai.storyfork.content.world.studio.entity.CardCategory
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 카드 카테고리 V18 SQL 계약이다. 엔티티와 칼럼이 어긋나면 ddl-auto=validate 때문에 CI 통합 테스트 전체가 깨지므로 DB 없이 이름을 대조한다. */
class CardCategorySchemaTest {
    private val dir = Path.of("src/main/resources/db/migration/worldstudio")
    private val v1 = Files.readString(dir.resolve("V1__independent_worldstudio.sql"))
    private val v18 = Files.readString(dir.resolve("V18__card_category.sql"))

    @Test fun `V18 creates the table and seeds the eight default categories with the labels the screens show`() {
        assertTrue(v18.contains("CREATE TABLE worldstudio.card_category ("))
        val seeds = Regex("\\('(\\w+)', '([^']+)', NULL, true, (\\d+)\\)").findAll(v18).map { Triple(it.groupValues[1], it.groupValues[2], it.groupValues[3].toInt()) }.toList()

        assertEquals(listOf(Triple("character", "인물", 1), Triple("location", "장소", 2), Triple("organization", "조직", 3), Triple("ability", "능력", 4),
            Triple("object", "사물", 5), Triple("rule", "규칙", 6), Triple("event", "사건", 7), Triple("other", "기타", 8)), seeds)
        assertEquals(DEFAULT_CARD_TYPES, seeds.map { it.first })
    }

    @Test fun `V18 drops exactly the two card_type checks that V1 created inline and no other migration adds one`() {
        for (table in listOf("setting_card_draft", "setting_card_version")) {
            val block = v1.substringAfter("CREATE TABLE worldstudio.${table} (").substringBefore("\n);")
            assertTrue(Regex("card_type text NOT NULL[^\n]*CHECK \\(card_type IN").containsMatchIn(block), table)
            // 한 열짜리 인라인 CHECK의 자동 이름은 <표>_<열>_check이다.
            assertTrue(v18.contains("ALTER TABLE worldstudio.${table} DROP CONSTRAINT ${table}_card_type_check;"), table)
        }
        val others = Files.list(dir).use { paths ->
            paths.filter { it.toString().endsWith(".sql") && it.fileName.toString() !in setOf("V1__independent_worldstudio.sql", "V18__card_category.sql") }.map { Files.readString(it) }.toList()
        }
        assertTrue(others.none { Regex("card_type[^;]*CHECK").containsMatchIn(it) })
        // V18 자신은 DROP CONSTRAINT만 쓰고(주석 제외) 새 CHECK를 걸지 않는다.
        assertTrue(v18.lines().filter { !it.trimStart().startsWith("--") }.none { "CHECK" in it })
    }

    @Test fun `the entity maps exactly the table columns`() {
        val block = Regex("CREATE TABLE worldstudio.card_category \\((.*?)\\n\\);", RegexOption.DOT_MATCHES_ALL).find(v18)!!.groupValues[1]
        val sqlColumns = block.lines().map { it.trim() }.filter { it.isNotEmpty() }.map { it.substringBefore(' ') }.toSet()
        val entityColumns = CardCategory::class.java.declaredFields.filter { !it.isSynthetic }.map { it.name }.toSet()

        assertEquals(sqlColumns, entityColumns)
        assertEquals(setOf("code", "name", "icon", "active", "position"), sqlColumns)
        assertTrue(block.contains("name text NOT NULL UNIQUE"), "같은 이름 두 개를 DB가 막는다")
    }
}
