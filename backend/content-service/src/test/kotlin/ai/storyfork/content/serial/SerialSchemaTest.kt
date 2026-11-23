package ai.storyfork.content.serial

import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialChoiceEntity
import ai.storyfork.content.serial.entity.SerialEpisodeSummaryEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.entity.SerialProposalLikeEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialBoardRepository
import ai.storyfork.content.serial.repository.SerialChoiceRepository
import ai.storyfork.content.serial.repository.SerialEpisodeSummaryRepository
import ai.storyfork.content.serial.repository.SerialProposalLikeRepository
import ai.storyfork.content.serial.repository.SerialProposalRepository
import ai.storyfork.content.serial.repository.SerialVoteRepository
import jakarta.persistence.Column
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.data.domain.Sort
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.parser.PartTree

/** DB 없이 V44 SQL을 계약과 엔티티·저장소에 대조한다. 어긋나면 ddl-auto=validate와 Spring Data 기동 검증 때문에 CI 통합 테스트 전체가 깨진다. */
class SerialSchemaTest {
    private val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V44__ai_serial.sql"))
    private val tables = sql.split("CREATE TABLE ").drop(1).associate { it.substringBefore(" (") to it.substringBefore("\n);") }
    private val keywords = setOf("PRIMARY", "UNIQUE", "FOREIGN", "CONSTRAINT", "CHECK")

    private fun columns(table: String) = Regex("^ {4}(\\w+) ", RegexOption.MULTILINE).findAll(tables.getValue(table)).map { it.groupValues[1] }.filter { it !in keywords }.toSet()
    private fun mapped(entity: Class<*>) = entity.declaredFields.mapNotNull { it.getAnnotation(Column::class.java)?.name }.toSet()

    @Test fun `V44 has the contract tables and nothing for setting proposals`() {
        assertEquals(setOf("ai_serial", "serial_board", "serial_choice", "serial_proposal", "serial_proposal_like", "serial_vote", "serial_episode_summary"), tables.keys)
        assertFalse(sql.contains("setting"), "설정 제안은 이 기능에서 제외됐다")
        // 투표·제안 개편은 V44를 직접 고친 것이다: 의견 표는 남지 않는다.
        assertFalse(sql.contains("serial_opinion") || sql.contains("opinion_id"))
    }

    @Test fun `each entity maps exactly the columns of its table`() {
        assertEquals(columns("ai_serial"), mapped(AiSerialEntity::class.java))
        assertEquals(columns("serial_board"), mapped(SerialBoardEntity::class.java))
        assertEquals(columns("serial_choice"), mapped(SerialChoiceEntity::class.java))
        assertEquals(columns("serial_proposal"), mapped(SerialProposalEntity::class.java))
        assertEquals(columns("serial_proposal_like"), mapped(SerialProposalLikeEntity::class.java))
        assertEquals(columns("serial_vote"), mapped(SerialVoteEntity::class.java))
        assertEquals(columns("serial_episode_summary"), mapped(SerialEpisodeSummaryEntity::class.java))
        assertEquals(setOf("work_id", "enabled", "days", "run_time", "direction", "last_run_date", "updated_at"), columns("ai_serial"))
        assertEquals(setOf("id", "work_id", "episode_number", "status", "summary", "published_episode_number", "failure_reason", "opened_at", "closed_at", "choices_tried_at"), columns("serial_board"))
        assertEquals(setOf("id", "board_id", "position", "text"), columns("serial_choice"))
        assertEquals(setOf("id", "board_id", "author_id", "kind", "title", "body", "simulation", "hidden", "created_at"), columns("serial_proposal"))
        assertEquals(setOf("proposal_id", "member_id"), columns("serial_proposal_like"))
        assertEquals(setOf("board_id", "member_id", "choice_id"), columns("serial_vote"))
        assertEquals(setOf("episode_id", "version_id", "summary", "created_at"), columns("serial_episode_summary"))
    }

    @Test fun `one active board per work is enforced by a partial unique index`() {
        assertTrue(Regex("CREATE UNIQUE INDEX \\w+ ON serial_board \\(work_id\\) WHERE status IN \\('open', ?'queued', ?'running'\\)").containsMatchIn(sql))
        assertTrue(tables.getValue("serial_board").contains("CHECK (status IN ('open','queued','running','published','failed'))"))
    }

    @Test fun `four numbered choices per board and no limit on proposals per member`() {
        assertTrue(tables.getValue("serial_choice").contains("CHECK (position BETWEEN 1 AND 4)"))
        assertTrue(tables.getValue("serial_choice").contains("UNIQUE (board_id, position)"))
        // 제안 글은 작성자당 개수 제한이 없다: (board_id, author_id) 유니크가 없다.
        assertFalse(tables.getValue("serial_proposal").contains("UNIQUE"))
        assertTrue(tables.getValue("serial_proposal").contains("CHECK (kind IN ('general','simulation'))"))
        assertTrue(tables.getValue("serial_proposal").contains("title text NOT NULL"))
    }

    @Test fun `one like per member per proposal and one vote per member per board on a choice`() {
        assertTrue(tables.getValue("serial_proposal_like").contains("PRIMARY KEY (proposal_id, member_id)"))
        assertTrue(tables.getValue("serial_vote").contains("PRIMARY KEY (board_id, member_id)"))
        assertTrue(tables.getValue("serial_vote").contains("choice_id varchar(36) NOT NULL REFERENCES serial_choice(id)"))
        assertTrue(tables.getValue("ai_serial").contains("work_id varchar(36) PRIMARY KEY REFERENCES work(id)"))
    }

    @Test fun `one summary per episode that points at the published version it was made from`() {
        // 회차마다 요약은 하나다: 발행 버전이 바뀌면 같은 행을 새 버전의 요약으로 바꾼다. 이력 표(episode_version)는 불변이라 FK가 안전하다.
        assertTrue(tables.getValue("serial_episode_summary").contains("episode_id varchar(36) PRIMARY KEY REFERENCES episode(id)"))
        assertTrue(tables.getValue("serial_episode_summary").contains("version_id varchar(36) NOT NULL REFERENCES episode_version(id)"))
        assertTrue(tables.getValue("serial_episode_summary").contains("summary text NOT NULL"))
    }

    @Test fun `the derived query names resolve against their entities`() {
        val repositories = mapOf(
            AiSerialRepository::class.java to AiSerialEntity::class.java,
            SerialBoardRepository::class.java to SerialBoardEntity::class.java,
            SerialChoiceRepository::class.java to SerialChoiceEntity::class.java,
            SerialProposalRepository::class.java to SerialProposalEntity::class.java,
            SerialProposalLikeRepository::class.java to SerialProposalLikeEntity::class.java,
            SerialVoteRepository::class.java to SerialVoteEntity::class.java,
            SerialEpisodeSummaryRepository::class.java to SerialEpisodeSummaryEntity::class.java,
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
        // 독자 화면의 제안 글: 숨기지 않은 글 최신순 최대 200개다.
        val shown = PartTree("findTop200ByBoardIdAndHiddenFalseOrderByCreatedAtDescIdDesc", SerialProposalEntity::class.java)
        assertEquals(200, shown.maxResults)
        assertEquals(Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")), shown.sort)
    }
}
