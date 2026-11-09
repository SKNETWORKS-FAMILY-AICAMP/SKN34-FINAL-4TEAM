package ai.storyfork.content.fork

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fixture.*
import ai.storyfork.content.fixture.model.*
import ai.storyfork.content.fork.service.ForkSeverService
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.work.service.WorkService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.context.bean.override.mockito.MockitoBean

/** 원작 삭제 전 Fork 분리를 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class ForkSeverPostgresTest {
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var sever: ForkSeverService
    @MockitoBean lateinit var ai: GenerationClient
    private val jdbc get() = JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))

    private fun setting(id: String, name: String, content: String, sid: String = "new"): WorldView {
        val w=driver.world(id,"author")
        val saved=driver.saveSetting(id,sid,"author",SettingRequest(w.revision,Setting(name=name,content=content,visibility="public",fromEpisode=1,knownBy=listOf("*")),w.sourceToken))
        return driver.commitSetting(id,saved.draft!!.id,"author",saved.revision)
    }
    private fun originalWithFork(): Pair<String,String> {
        val w=driver.create("author",CreateWorkRequest("분리 검증 "+contentId()))
        setting(w.id,"규칙","처음")
        val d=driver.edit(w.id,"author",DraftRequest("1화","공개 원고",0))
        driver.publish(w.id,"author",PublishRequest(d.revision,true,true,true,driver.history(w.id,"author").versions.last().id))
        return w.id to driver.fork(w.id,"reader",ForkRequest(1,"분기")).id
    }
    /** 원작 소유 체크포인트를 지울 수 있다면 Fork 쪽에 원작을 가리키는 행이 남지 않은 것이다. */
    private fun deleteSourceCheckpoints(original: String) {
        val own="SELECT id FROM checkpoint WHERE work_id=?"
        jdbc.update("DELETE FROM checkpoint_episode WHERE checkpoint_id IN ($own)",original)
        jdbc.update("DELETE FROM checkpoint_setting WHERE checkpoint_id IN ($own)",original)
        jdbc.update("DELETE FROM checkpoint WHERE work_id=?",original)
    }

    @Test fun `following Fork keeps its world and stays a Fork after separation`() {
        val (original,fork)=originalWithFork()

        sever.sever(fork)

        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork WHERE work_id=? AND source_work_id IS NULL AND source_checkpoint_id IS NULL AND source_deleted_at IS NOT NULL AND basis_episode=1 AND basis_version IS NOT NULL AND source_title LIKE '분리 검증%'",Int::class.java,fork))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork_world_reference WHERE fork_work_id=? AND source_world_id IS NULL AND reference_status='independent' AND detached_at IS NOT NULL",Int::class.java,fork))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM fork_source_setting WHERE fork_work_id=?",Int::class.java,fork))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM setting_origin o JOIN setting_document d ON d.id=o.setting_document_id WHERE d.world_id=?",Int::class.java,fork))
        assertEquals("처음",driver.world(fork,"reader").settings.single().content)
        val source=works.read(fork,"reader").source!!
        assertTrue(source.deleted)
        assertEquals(1,source.episode)
        assertEquals(409,assertThrows(ContentFailure::class.java) { driver.change(fork,"reader",ChangeRequest(0,"none","apply")) }.status)
        assertEquals(403,assertThrows(ContentFailure::class.java) { driver.fork(fork,"another",ForkRequest(1,"재분기")) }.status)
        deleteSourceCheckpoints(original)
    }

    @Test fun `independent Fork with applied source changes is separated and its result checkpoint is removed`() {
        val (original,fork)=originalWithFork()
        val sid=driver.world(original,"author").settings.first().id
        var f=driver.world(fork,"reader")
        f=driver.saveSetting(fork,sid,"reader",SettingRequest(f.revision,f.settings.single().copy(content="독립"),f.sourceToken))
        f=driver.commitSetting(fork,sid,"reader",f.revision)
        setting(original,"규칙","정정",sid)
        f=driver.world(fork,"reader")
        driver.change(fork,"reader",ChangeRequest(f.revision,f.changes.single().id,"apply"))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork_change_application a JOIN fork_change_decision d ON d.id=a.decision_id JOIN fork_source_change c ON c.id=d.source_change_id WHERE c.fork_work_id=? AND a.result_checkpoint_id IS NOT NULL",Int::class.java,fork))

        sever.sever(fork)

        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM fork_change_application a JOIN fork_change_decision d ON d.id=a.decision_id JOIN fork_source_change c ON c.id=d.source_change_id WHERE c.fork_work_id=? AND a.result_checkpoint_id IS NOT NULL",Int::class.java,fork))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM fork_source_change WHERE fork_work_id=? AND (before_checkpoint_id IS NOT NULL OR after_checkpoint_id IS NOT NULL)",Int::class.java,fork))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork_change_decision d JOIN fork_source_change c ON c.id=d.source_change_id WHERE c.fork_work_id=?",Int::class.java,fork))
        assertEquals("정정",driver.world(fork,"reader").settings.single().content)
        deleteSourceCheckpoints(original)
    }

    @Test fun `severing twice is harmless and severAll separates the Forks of an original`() {
        val (original,fork)=originalWithFork()

        sever.severAll(original)
        sever.sever(fork)

        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork WHERE work_id=? AND source_deleted_at IS NOT NULL",Int::class.java,fork))
    }
}
