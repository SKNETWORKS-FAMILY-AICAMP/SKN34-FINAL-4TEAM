package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.entity.ContentImage
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** 원고 이미지 전용 Flyway 이력은 V1 위에 V2(대체 텍스트)만 더한다. DB 없이 SQL 파일과 매핑 기본값만 확인한다. */
class ContentImageMigrationFileTest {
    private val leaf = Path.of("src/main/resources/db/migration/contentimage")

    @Test fun `content image history adds only the alt text column on top of the untouched first migration`() {
        val names = Files.list(leaf).use { paths -> paths.map { it.fileName.toString() }.sorted().toList() }
        assertEquals(listOf("V1__content_image.sql", "V2__content_image_alt_text.sql"), names)
        assertEquals("ALTER TABLE content_image ADD COLUMN alt_text varchar(300) NOT NULL DEFAULT '';", Files.readString(leaf.resolve(names[1])).trim())
        assertTrue(!Files.readString(leaf.resolve(names[0])).contains("alt_text"))
    }

    @Test fun `a new image has an empty alt text`() {
        assertEquals("", ContentImage().altText)
    }
}
