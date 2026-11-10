package ai.storyfork.content.feedbackreport

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Spring·DB 없이 확인하는 고정 지점이다. 새 기능 패키지는 JPA 스캔과 예외 핸들러에 등록하지 않으면 CI 통합 테스트에서만 한꺼번에 깨지고,
 * V24 SQL은 계약의 저장 정의를 그대로 따라야 한다.
 */
class FeedbackReportWiringTest {
    private val root = Path.of("src/main/kotlin/ai/storyfork/content")
    private val sql = Files.readString(Path.of("src/main/resources/db/migration/work/V24__feedback_report.sql"))

    @Test fun `the package is registered for JPA scanning and the content exception handler`() {
        val config = Files.readString(root.resolve("_common/config/ContentPersistenceConfig.kt"))
        assertTrue(config.contains("\"ai.storyfork.content.feedbackreport.repository\""))
        assertTrue(config.contains("\"ai.storyfork.content.feedbackreport.entity\""))
        assertTrue(Files.readString(root.resolve("_common/exception/ContentExceptionHandler.kt")).contains("\"ai.storyfork.content.feedbackreport.controller\""))
    }

    @Test fun `V24 keeps the contract tables constraints and indexes`() {
        val tables = Regex("CREATE TABLE (\\w+) \\((.*?)\\n\\);", RegexOption.DOT_MATCHES_ALL).findAll(sql).associate { it.groupValues[1] to it.groupValues[2] }
        assertEquals(listOf("feedback_report", "feedback_report_amendment", "feedback_report_response"), tables.keys.toList())
        val report = tables.getValue("feedback_report")
        assertTrue(report.contains("work_id varchar(36) NOT NULL REFERENCES work(id)"))
        assertTrue(report.contains("published_version_id varchar(36) NOT NULL REFERENCES episode_version(id)"))
        assertTrue(report.contains("episode_number integer NOT NULL CHECK (episode_number > 0)"))
        assertTrue(report.contains("kind text NOT NULL CHECK (kind IN ('typo','story','question','suggestion'))"))
        assertTrue(report.contains("visibility text NOT NULL CHECK (visibility IN ('public','private'))"))
        assertTrue(report.contains("status text NOT NULL CHECK (status IN ('unchecked','checked','answered','resolved','closed'))"))
        // 이름은 저장하지 않는다(Core 닉네임 조회).
        assertFalse(Regex("reporter_name|author_name").containsMatchIn(sql))
        assertTrue(tables.getValue("feedback_report_amendment").contains("action text NOT NULL CHECK (action IN ('correct','withdraw'))"))
        assertTrue(tables.getValue("feedback_report_amendment").contains("report_id varchar(36) NOT NULL REFERENCES feedback_report(id)"))
        assertTrue(tables.getValue("feedback_report_response").contains("is_public boolean NOT NULL"))
        assertTrue(sql.contains("CREATE INDEX feedback_report_episode ON feedback_report (work_id, episode_number, created_at DESC);"))
        assertTrue(sql.contains("CREATE INDEX feedback_report_reporter ON feedback_report (reporter_id, created_at DESC);"))
        // 제보는 지우지 않는다(DEC-42).
        assertFalse(Regex("deleted_at|DROP |DELETE ").containsMatchIn(sql))
    }
}
