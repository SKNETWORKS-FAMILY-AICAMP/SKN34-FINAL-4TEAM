package ai.storyfork.core.content

import ai.storyfork.core.content.client.GenerationClient
import ai.storyfork.core.content.client.dto.GenerationResponse
import ai.storyfork.core.content.controller.dto.*
import ai.storyfork.core.content.domain.*
import ai.storyfork.core.content.service.ContentService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.mockito.Mockito.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest(properties=["app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","CONTENT_DATABASE_USER=content_test","CONTENT_DATABASE_PASSWORD="])
class ContentPostgresTest {
    @Autowired lateinit var service: ContentService
    @MockitoBean lateinit var ai: GenerationClient
    private fun create() = service.create("author",CreateWorkRequest("통합 검증 "+contentId()))
    private val jdbc get() = JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))
    @Test fun `content is stored in ERD tables with episode ownership constraints`() {
        val w=create()
        val d=service.edit(w.id,"author",DraftRequest("1화","관계형 원고",0))
        service.publish(w.id,"author",PublishRequest(d.revision,true,true,true,service.history(w.id,"author").versions.last().id))
        assertEquals("author",jdbc.queryForObject("SELECT owner_id FROM work WHERE id=?",String::class.java,w.id))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM episode e JOIN episode_version v ON e.id=v.episode_id JOIN publication_event p ON p.episode_version_id=v.id WHERE e.work_id=?",Int::class.java,w.id))
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM episode_draft d JOIN episode e ON e.id=d.episode_id WHERE e.work_id=?",Int::class.java,w.id))
        val other=create()
        service.fork(w.id,"constraint-reader",ForkRequest(1,"제약 검증"))
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) {
            jdbc.update("INSERT INTO checkpoint_episode(checkpoint_id,source_work_id,episode_id,episode_version_id) SELECT c.id,c.work_id,e.id,v.id FROM checkpoint c CROSS JOIN episode e CROSS JOIN episode_version v WHERE e.work_id=? AND v.episode_id IN (SELECT id FROM episode WHERE work_id=?) LIMIT 1",other.id,w.id)
        }
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM content_work WHERE id=?",Int::class.java,w.id))
    }
    @Test fun `latest ERD derives current values and separates AI selection and application`() {
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='work' AND column_name IN ('world_id','allow_fork_creation','allow_fork_publication','visibility_status','genre')",Int::class.java))
        val w=create()
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM work_world_history WHERE work_id=?",Int::class.java,w.id))
        `when`(ai.generate(service.readContext(w.id,"author",1,"계속",""),"계속")).thenReturn(GenerationResponse("정규화 제안","stub-model"))
        val p=service.propose(w.id,"author",ProposalRequest(0,"계속",true))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM proposal_decision WHERE proposal_id=?",Int::class.java,p.id))
        service.accept(w.id,p.id,"author",0)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM proposal_decision d JOIN proposal_application a ON a.decision_id=d.id JOIN proposal_episode_change c ON c.application_id=a.id WHERE d.proposal_id=? AND a.outcome='applied'",Int::class.java,p.id))
    }
    @Test fun `failed AI calls retain job failure without a successful proposal`() {
        val w=create()
        `when`(ai.generate(service.readContext(w.id,"author",1,"실패",""),"실패")).thenThrow(ContentFailure(503,"테스트 장애"))
        assertEquals(503,assertThrows(ContentFailure::class.java) { service.propose(w.id,"author",ProposalRequest(0,"실패",true)) }.status)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_job j JOIN ai_model_call c ON c.job_id=j.id WHERE j.work_id=? AND j.status='failed' AND c.status='failed' AND c.input_tokens IS NULL",Int::class.java,w.id))
        assertTrue(service.history(w.id,"author").proposals.isEmpty())
    }
    @Test fun `stale manuscript preserves completed provider usage but does not apply`() {
        val w=create()
        `when`(ai.generate(service.readContext(w.id,"author",1,"대기",""),"대기")).thenAnswer {
            service.edit(w.id,"author",DraftRequest("수정","사용자의 새 원고",0))
            GenerationResponse("적용하면 안 되는 제안","stub-model",usage=Usage(4,2))
        }
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.propose(w.id,"author",ProposalRequest(0,"대기",true)) }.status)
        assertEquals("사용자의 새 원고",service.read(w.id,"author").draft!!.body)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_job j JOIN ai_model_call c ON c.job_id=j.id WHERE j.work_id=? AND j.status='failed' AND j.failure_reason='STALE_CONTEXT' AND c.status='completed' AND c.input_tokens=4",Int::class.java,w.id))
    }
    private fun setting(id: String,name: String,content: String,public: Boolean = true,at: Int = 1,sid: String = "new"): WorldView {
        val w=service.world(id,"author")
        val saved=service.saveSetting(id,sid,"author",SettingRequest(w.revision,Setting(name=name,content=content,visibility=if(public) "public" else "private",fromEpisode=at,knownBy=listOf("*")),w.sourceToken))
        return service.commitSetting(id,saved.draft!!.id,"author",saved.revision)
    }
    @Test fun `postgres protects owners versions and publication`() {
        val w=create()
        assertThrows(ContentFailure::class.java) { service.read(w.id,"other") }
        val d=service.edit(w.id,"author",DraftRequest("1화","원고",0))
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.edit(w.id,"author",DraftRequest("1화","덮어쓰기",0)) }.status)
        assertEquals("원고",service.read(w.id,"author").draft!!.body)
        val published=service.publish(w.id,"author",PublishRequest(d.revision,true,true,true,service.history(w.id,"author").versions.last().id))
        assertEquals(1,published.episodes.size)
        assertNull(service.publicRead(w.id).draft)
        assertEquals(1,service.history(w.id,"author").versions.size)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM work_rights_declaration WHERE work_id=? AND response='confirmed'",Int::class.java,w.id))
    }
    @Test fun `fork follows detaches and applies only selected source corrections`() {
        val w=create(); val world=setting(w.id,"규칙","처음")
        setting(w.id,"비밀","SECRET",false); setting(w.id,"미래","FUTURE",at=4)
        val d=service.edit(w.id,"author",DraftRequest("1화","공개 원고",0))
        service.publish(w.id,"author",PublishRequest(d.revision,true,true,true,service.history(w.id,"author").versions.last().id))
        val fork=service.fork(w.id,"reader",ForkRequest(1,"분기"))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork WHERE work_id=? AND confirmed_policy_history_id IS NOT NULL AND conditions_confirmed_at IS NOT NULL",Int::class.java,fork.id))
        assertEquals(1,service.world(fork.id,"reader").settings.size)
        val sid=world.settings.first().id
        setting(w.id,"규칙","정정 A",sid=sid)
        var f=service.world(fork.id,"reader")
        assertEquals("정정 A",f.settings.single().content)
        f=service.saveSetting(fork.id,sid,"reader",SettingRequest(f.revision,f.settings.single().copy(content="독립"),f.sourceToken))
        f=service.commitSetting(fork.id,sid,"reader",f.revision)
        assertEquals("independent",f.mode)
        setting(w.id,"규칙","정정 B",sid=sid)
        f=service.world(fork.id,"reader"); assertEquals("독립",f.settings.single().content)
        f=service.change(fork.id,"reader",ChangeRequest(f.revision,f.changes.single().id,"reject"))
        f=service.change(fork.id,"reader",ChangeRequest(f.revision,f.changes.single().id,"apply"))
        assertEquals("정정 B",f.settings.single().content)
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.change(fork.id,"reader",ChangeRequest(f.revision,f.changes.single().id,"reject")) }.status)
        assertEquals(1,f.basis!!.episode)
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM fork_change_decision d JOIN fork_source_change c ON c.id=d.source_change_id WHERE c.fork_work_id=?",Int::class.java,fork.id))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM fork_change_application a JOIN fork_change_decision d ON d.id=a.decision_id JOIN fork_source_change c ON c.id=d.source_change_id WHERE c.fork_work_id=?",Int::class.java,fork.id))
    }
    @Test fun `paid proposal is not applied until explicit accept and stale context is rejected`() {
        val w=create()
        `when`(ai.generate(service.readContext(w.id,"author",1,"계속",""),"계속")).thenReturn(GenerationResponse("이어쓰기","stub-model"))
        val p=service.propose(w.id,"author",ProposalRequest(0,"계속",true))
        assertEquals("",service.read(w.id,"author").draft!!.body)
        assertEquals("이어쓰기",service.accept(w.id,p.id,"author",0).body)
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.accept(w.id,p.id,"author",1) }.status)
        `when`(ai.generate(service.readContext(w.id,"author",1,"계속",""),"계속")).thenReturn(GenerationResponse("추가","stub-model"))
        val p2=service.propose(w.id,"author",ProposalRequest(1,"계속",true))
        setting(w.id,"새 규칙","변경")
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.accept(w.id,p2.id,"author",1) }.status)
    }
}
