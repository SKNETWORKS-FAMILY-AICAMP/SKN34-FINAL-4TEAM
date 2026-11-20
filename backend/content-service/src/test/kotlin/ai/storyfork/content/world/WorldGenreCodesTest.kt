package ai.storyfork.content.world

import ai.storyfork.content.world.service.GenreTemplateSeeder
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * 세계관 장르를 Content 장르 코드로 합치는 DEC-56 계약이다. V14 SQL의 변환 표와 템플릿 시더의 장르 매핑이 같은 표를 따라야
 * 이미 적재된 템플릿 세계관이 '원본'(저장된 장르가 비었거나 매핑 값과 같음) 판정을 계속 통과한다. DB 없이 SQL 문구와 소스 값을 대조한다.
 */
class WorldGenreCodesTest {
    private val v14 = Files.readString(Path.of("src/main/resources/db/migration/worldstudio/V14__world_genre_codes.sql"))
    private val v1 = Files.readString(Path.of("src/main/resources/db/migration/work/V1__work.sql"))

    /** 계약 표: 옛 세계관 코드 → Content 장르 코드. */
    private val conversion = mapOf(
        "fantasy" to "genre-01", "wuxia" to "genre-03", "romance" to "genre-06", "modern" to "genre-10",
        "sf" to "genre-14", "mystery" to "genre-18", "classic" to "genre-28",
    )

    @Test fun `V14 drops the genre check and converts exactly the seven old codes`() {
        assertTrue(v14.contains("ALTER TABLE worldstudio.world DROP CONSTRAINT world_genre_check;"))
        assertEquals(conversion, Regex("WHEN '(\\w+)' THEN '(genre-\\d+)'").findAll(v14).associate { it.groupValues[1] to it.groupValues[2] })
        val where = Regex("WHERE genre IN \\(([^)]*)\\);").find(v14)!!.groupValues[1]
        assertEquals(conversion.keys, Regex("'(\\w+)'").findAll(where).map { it.groupValues[1] }.toSet(), "옛 코드가 아닌 행은 건드리지 않는다")
    }

    @Test fun `the converted codes are Content genres with the names of the contract table`() {
        val names = Regex("\\('(genre-\\d+)', 'genre-\\d+', '([^']+)'\\)").findAll(v1).associate { it.groupValues[1] to it.groupValues[2] }
        assertEquals(listOf("판타지", "무협", "로맨스", "현대", "SF", "미스터리", "고전"), conversion.values.map { names[it] })
    }

    @Test fun `template world genres are the same conversion of the old template mapping`() {
        // DEC-56 이전의 TEMPLATE_WORLD_GENRES(템플릿 키 → 옛 세계관 코드)다.
        val old = mapOf(
            "wuxia" to "wuxia", "romance_fantasy" to "romance",
            "modern_fantasy" to "fantasy", "game_fantasy" to "fantasy", "fusion_fantasy" to "fantasy",
            "territory_management" to "fantasy", "sports_fantasy" to "fantasy",
            "science_fiction" to "sf", "apocalypse" to "sf", "entertainment" to "modern",
            "cthulhu_mythos" to "mystery",
            "alternate_history" to "classic", "sumerian_mythology" to "classic", "norse_mythology" to "classic",
            "greco_roman_mythology" to "classic", "germanic_folklore" to "classic", "chinese_folklore" to "classic",
            "japanese_mythology" to "classic", "korean_mythology_fables" to "classic", "egyptian_mythology" to "classic",
            "indian_mythology" to "classic", "celtic_mythology" to "classic", "slavic_mythology" to "classic",
            "maya_mythology" to "classic", "aztec_mythology" to "classic", "hawaiian_tradition" to "classic",
            "inca_tradition" to "classic", "persian_tradition" to "classic", "journey_to_the_west" to "classic",
            "england_history" to "classic", "usa_history" to "classic", "china_history" to "classic",
            "korea_history" to "classic", "japan_history" to "classic", "france_history" to "classic", "italy_history" to "classic",
        )
        val field = GenreTemplateSeeder::class.java.getDeclaredField("TEMPLATE_WORLD_GENRES").apply { isAccessible = true }
        assertEquals(old.mapValues { conversion.getValue(it.value) }, field.get(null))
        assertEquals("genre-01", GenreTemplateSeeder.mappedWorldGenre("modern_fantasy"))
        assertNull(GenreTemplateSeeder.mappedWorldGenre("unknown_template"))
    }
}
