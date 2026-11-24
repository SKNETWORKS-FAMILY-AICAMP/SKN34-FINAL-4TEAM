package ai.storyfork.content.attachment

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** 설정 첨부 이력은 V1을 그대로 두고 V2가 첨부 대상에 세계관 카드를 더한다(#735). DB 없이 SQL 파일만 확인한다. */
class SettingAttachmentCardMigrationFileTest {
    private val leaf = Path.of("src/main/resources/db/migration/settingattachment")

    @Test fun `the history keeps the first migration and adds one card migration`() {
        val names = Files.list(leaf).use { paths -> paths.map { it.fileName.toString() }.sorted().toList() }
        assertEquals(listOf("V1__setting_attachment.sql", "V2__setting_attachment_world_card.sql"), names)
        assertFalse(Files.readString(leaf.resolve(names[0])).contains("world_card_id"))
    }

    @Test fun `an attachment points at exactly one of a setting document or a world card without a cross schema foreign key`() {
        val sql = Files.readString(leaf.resolve("V2__setting_attachment_world_card.sql"))
        assertTrue(Regex("ALTER COLUMN setting_document_id DROP NOT NULL").containsMatchIn(sql))
        assertTrue(Regex("ADD COLUMN world_card_id varchar\\(36\\)").containsMatchIn(sql))
        assertTrue(Regex("CHECK \\(\\(setting_document_id IS NULL\\) <> \\(world_card_id IS NULL\\)\\)").containsMatchIn(sql))
        // 카드는 worldstudio 스키마와 별도 이력이라 FK를 두지 않고 서비스가 소유 세계관·지우지 않은 카드를 확인한다.
        assertFalse(sql.contains("REFERENCES"))
    }
}
