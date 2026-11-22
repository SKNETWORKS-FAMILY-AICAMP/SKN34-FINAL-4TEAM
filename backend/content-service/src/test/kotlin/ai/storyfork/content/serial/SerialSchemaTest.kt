package ai.storyfork.content.serial

import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialOpinionEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialBoardRepository
import ai.storyfork.content.serial.repository.SerialOpinionRepository
import ai.storyfork.content.serial.repository.SerialVoteRepository
import jakarta.persistence.Column
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.data.domain.Sort
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.parser.PartTree

/** DB 없이 V43 SQL을 계약과 엔티티·저장소에 대조한다. 어긋나면 ddl-auto=validate와 Spring Data 기동 검증 때문에 CI 통합 테스트 전체가 깨진다. */
class SerialSchemaTest {
    private val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V43__ai_serial.sql"))
    private val tables = sql.split("CREATE TABLE ").drop(1).associate { it.substringBefore(" (") to it.substringBefore("\n);") }
    private val keywords = setOf("PRIMARY", "UNIQUE", "FOREIGN", "CONSTRAINT", "CHECK")

    private fun columns(table: String) = Regex("^ {4}(\\w+) ", RegexOption.MULTILINE).findAll(tables.getValue(table)).map { it.groupValues[1] }.filter { it !in keywords }.toSet()
    private fun mapped(entity: Class<*>) = entity.declaredFields.mapNotNull { it.getAnnotation(Column::class.java)?.name }.toSet()

    @Test fun `V43 has the four contract tables and nothing for setting proposals`() {
        assertEquals(setOf("ai_serial", "serial_board", "serial_opinion", "serial_vote"), tables.keys)
        assertFalse(sql.contains("setting"), "설정 제안은 이 기능에서 제외됐다")
    }

    @Test fun `each entity maps exactly the columns of its table`() {
        assertEquals(columns("ai_serial"), mapped(AiSerialEntity::class.java))
        assertEquals(columns("serial_board"), mapped(SerialBoardEntity::class.java))
        assertEquals(columns("serial_opinion"), mapped(SerialOpinionEntity::class.java))
        assertEquals(columns("serial_vote"), mapped(SerialVoteEntity::class.java))
        assertEquals(setOf("work_id", "enabled", "days", "run_time", "direction", "last_run_date", "updated_at"), columns("ai_serial"))
        assertEquals(setOf("id", "board_id", "author_id", "kind", "body", "simulation", "hidden", "created_at"), columns("serial_opinion"))
    }

    @Test fun `one active board per work is enforced by a partial unique index`() {
        assertTrue(Regex("CREATE UNIQUE INDEX \\w+ ON serial_board \\(work_id\\) WHERE status IN \\('open', ?'queued', ?'running'\\)").containsMatchIn(sql))
        assertTrue(tables.getValue("serial_board").contains("CHECK (status IN ('open','queued','running','published','failed'))"))
    }

    @Test fun `one opinion per member per board and one vote per member per board`() {
        assertTrue(tables.getValue("serial_opinion").contains("UNIQUE (board_id, author_id)"))
        assertTrue(tables.getValue("serial_opinion").contains("CHECK (kind IN ('general','simulation'))"))
        assertTrue(tables.getValue("serial_vote").contains("PRIMARY KEY (board_id, member_id)"))
        assertTrue(tables.getValue("ai_serial").contains("work_id varchar(36) PRIMARY KEY REFERENCES work(id)"))
    }

    @Test fun `the derived query names resolve against their entities`() {
        val repositories = mapOf(
            AiSerialRepository::class.java to AiSerialEntity::class.java,
            SerialBoardRepository::class.java to SerialBoardEntity::class.java,
            SerialOpinionRepository::class.java to SerialOpinionEntity::class.java,
            SerialVoteRepository::class.java to SerialVoteEntity::class.java,
        )
        for ((repository, entity) in repositories) {
            for (method in repository.declaredMethods.filter { it.getAnnotation(Query::class.java) == null }) {
                assertNotNull(PartTree(method.name, entity), method.name) // 없는 속성이면 PropertyReferenceException
            }
        }
        val owner = SerialBoardRepository::class.java.declaredMethods.associate { it.name to it }
        val newest = PartTree("findTop50ByWorkIdOrderByOpenedAtDescIdDesc", SerialBoardEntity::class.java)
        assertEquals(50, newest.maxResults)
        assertEquals(Sort.by(Sort.Order.desc("openedAt"), Sort.Order.desc("id")), newest.sort)
        assertTrue(owner.containsKey("claim"))
    }
}
