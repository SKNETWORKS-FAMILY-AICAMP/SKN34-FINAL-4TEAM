package ai.storyfork.content.regression

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.proposal.client.dto.GenerationResponse
import ai.storyfork.content.proposal.service.dto.UsageResponse
import ai.storyfork.content.fixture.*
import ai.storyfork.content.fixture.model.*
import ai.storyfork.content.fixture.ContentTestDriver
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
@org.springframework.context.annotation.Import(ai.storyfork.content.fixture.ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class ContentPostgresTest {
    // 작가명·작성자명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 빈 결과를 돌려주는 대역이다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var service: ContentTestDriver
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
        assertNull(jdbc.queryForObject("SELECT to_regclass('content_work')::text",String::class.java))
    }
    @Test fun `latest ERD derives current values and separates AI selection and application`() {
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='work' AND column_name IN ('world_id','allow_fork_creation','allow_fork_publication','visibility_status','genre')",Int::class.java))
        val w=create()
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM work_world_history WHERE work_id=?",Int::class.java,w.id))
        `when`(ai.generate(service.generationRequest(w.id,"author",1,"계속",""))).thenReturn(GenerationResponse("정규화 제안","stub-model"))
        val p=service.propose(w.id,"author",ProposalRequest(0,"계속",true))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM proposal_decision WHERE proposal_id=?",Int::class.java,p.id))
        service.accept(w.id,p.id,"author",0)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM proposal_decision d JOIN proposal_application a ON a.decision_id=d.id JOIN proposal_episode_change c ON c.application_id=a.id WHERE d.proposal_id=? AND a.outcome='applied'",Int::class.java,p.id))
    }
    @Test fun `failed AI calls retain job failure without a successful proposal`() {
        val w=create()
        `when`(ai.generate(service.generationRequest(w.id,"author",1,"실패",""))).thenThrow(ContentFailure(503,"테스트 장애"))
        assertEquals(503,assertThrows(ContentFailure::class.java) { service.propose(w.id,"author",ProposalRequest(0,"실패",true)) }.status)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_job j JOIN ai_model_call c ON c.job_id=j.id WHERE j.work_id=? AND j.status='failed' AND c.status='failed' AND c.input_tokens IS NULL",Int::class.java,w.id))
        assertTrue(service.history(w.id,"author").proposals.isEmpty())
    }
    @Test fun `stale manuscript preserves completed provider usage but does not apply`() {
        val w=create()
        `when`(ai.generate(service.generationRequest(w.id,"author",1,"대기",""))).thenAnswer {
            service.edit(w.id,"author",DraftRequest("수정","사용자의 새 원고",0))
            GenerationResponse("적용하면 안 되는 제안","stub-model",usage=UsageResponse(4,2))
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
        `when`(ai.generate(service.generationRequest(w.id,"author",1,"계속",""))).thenReturn(GenerationResponse("이어쓰기","stub-model"))
        val p=service.propose(w.id,"author",ProposalRequest(0,"계속",true))
        assertEquals("",service.read(w.id,"author").draft!!.body)
        assertEquals("이어쓰기",service.accept(w.id,p.id,"author",0).body)
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.accept(w.id,p.id,"author",1) }.status)
        `when`(ai.generate(service.generationRequest(w.id,"author",1,"계속",""))).thenReturn(GenerationResponse("추가","stub-model"))
        val p2=service.propose(w.id,"author",ProposalRequest(1,"계속",true))
        setting(w.id,"새 규칙","변경")
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.accept(w.id,p2.id,"author",1) }.status)
    }
    @Test fun `AI references explicit target and result when episode revisions overlap`() {
        val work=create()
        val first=service.writeEpisode(work.id,"author",1,DraftRequest("1화","첫 원고",0),true)
        service.publishEpisode(work.id,"author",1,PublishRequest(first.draft.revision,true,true,true,first.versions.last().id))
        val secondDraft=service.createEpisode(work.id,"author",CreateWorkRequest("2화"))
        val second=service.writeEpisode(work.id,"author",2,DraftRequest("2화","다른 회차",secondDraft.draft.revision),true)
        service.publishEpisode(work.id,"author",2,PublishRequest(second.draft.revision,true,true,true,second.versions.last().id))
        val target=service.createEpisode(work.id,"author",CreateWorkRequest("3화"))
        service.writeEpisode(work.id,"author",3,DraftRequest("3화","대상 초안",target.draft.revision),false)
        assertEquals(first.versions.last().revision,service.writing(work.id,"author",3).draft.revision)
        `when`(ai.generate(service.generationRequest(work.id,"author",3,"계속",""))).thenReturn(GenerationResponse("제안","stub-model"))
        val revision=service.read(work.id,"author").draft!!.revision
        val proposal=service.propose(work.id,"author",ProposalRequest(revision,"계속",true,episode=3))
        assertEquals(3,jdbc.queryForObject("SELECT e.sequence FROM ai_input_snapshot i JOIN episode e ON e.id=i.episode_id WHERE i.job_id=?",Int::class.java,proposal.id))
        service.accept(work.id,proposal.id,"author",revision)
        val result=service.history(work.id,"author").versions.last()
        assertEquals(3,result.episode)
        assertEquals(result.id,jdbc.queryForObject("SELECT v.content_version_id FROM proposal_episode_change c JOIN proposal_application a ON a.id=c.application_id JOIN proposal_decision d ON d.id=a.decision_id JOIN episode_version v ON v.id=c.result_version_id WHERE d.proposal_id=?",String::class.java,proposal.id))
        service.policy(work.id,"author",PolicyRequest(service.read(work.id,"author").draft!!.revision,true,true))
        assertEquals(3,jdbc.queryForObject("SELECT e.sequence FROM ai_input_snapshot i JOIN episode e ON e.id=i.episode_id WHERE i.job_id=?",Int::class.java,proposal.id))
    }

    @Test fun `visibility range rejects another work and reversed episode boundaries`() {
        val a=create();val b=create()
        service.createEpisode(a.id,"author",CreateWorkRequest("2화"))
        setting(a.id,"범위","내용")
        val policy=jdbc.queryForObject("SELECT h.id FROM setting_visibility_history h JOIN setting_document d ON d.id=h.setting_document_id JOIN work_current w ON w.world_id=d.world_id WHERE w.id=?",String::class.java,a.id)!!
        fun episode(work:String,number:Int)=jdbc.queryForObject("SELECT id FROM episode WHERE work_id=? AND sequence=?",String::class.java,work,number)!!
        for((start,end) in listOf(episode(a.id,1) to episode(b.id,1),episode(a.id,2) to episode(a.id,1))) {
            assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) {
                jdbc.update("INSERT INTO setting_visibility_range VALUES (?,?,?,?,?)",contentId(),policy,start,end,"public")
            }
        }
    }

    @Test fun `a visibility range for another work is not used in this works context`() {
        val a=create();val b=create()
        setting(a.id,"비공개 규칙","원작 비밀",false)
        val policy=jdbc.queryForObject("SELECT h.id FROM setting_visibility_history h JOIN setting_document d ON d.id=h.setting_document_id JOIN work_current w ON w.world_id=d.world_id WHERE w.id=?",String::class.java,a.id)!!
        val other=jdbc.queryForObject("SELECT id FROM episode WHERE work_id=? AND sequence=1",String::class.java,b.id)!!
        jdbc.update("INSERT INTO setting_visibility_range VALUES (?,?,?,?,?)",contentId(),policy,other,null,"public")
        assertEquals(1,service.world(a.id,"author").history.size)
        assertEquals("private",service.world(a.id,"author").settings.single().visibility)
    }

    private fun foreignOnlyRange(work: String,sid: String,other: String,defaultVisibility: String) {
        val policy=jdbc.queryForObject("""SELECT v.visibility_history_id FROM setting_version v JOIN setting_document d ON d.id=v.setting_document_id
            JOIN work_current w ON w.world_id=d.world_id WHERE w.id=? AND d.logical_id=? ORDER BY v.revision_no DESC LIMIT 1""",String::class.java,work,sid)!!
        jdbc.update("UPDATE setting_visibility_history SET default_visibility=? WHERE id=?",defaultVisibility,policy)
        assertEquals(1,jdbc.update("""UPDATE setting_visibility_range SET start_episode_id=(SELECT id FROM episode WHERE work_id=? AND sequence=1),
            end_episode_id=NULL,visibility=? WHERE visibility_history_id=?""",other,if(defaultVisibility=="private") "public" else "private",policy))
    }

    @Test fun `foreign only range preserves latest private setting and cannot revive older public content`() {
        val a=create();val b=create()
        val sid=setting(a.id,"규칙","이전 공개 내용").settings.single().id
        val d=service.edit(a.id,"author",DraftRequest("1화","발행 원고",0))
        service.publish(a.id,"author",PublishRequest(d.revision,true,true,true,service.history(a.id,"author").versions.last().id))
        val latest=setting(a.id,"규칙","현재 비공개 내용",false,sid=sid).settings.single()
        foreignOnlyRange(a.id,sid,b.id,"private")

        val world=service.world(a.id,"author")
        assertEquals(2,world.history.size)
        assertEquals(latest.versionId,world.settings.single().versionId)
        assertEquals("private",world.settings.single().visibility)
        assertTrue(service.readContext(a.id,null,1,"","").settings.isEmpty())
        val fork=service.fork(a.id,"private-range-reader",ForkRequest(1,"비공개 설정 제외"))
        assertTrue(service.world(fork.id,"private-range-reader").settings.isEmpty())
        assertTrue(service.world(fork.id,"private-range-reader").basis!!.settings.isEmpty())
    }

    @Test fun `foreign only range retains default public setting in fork basis and source snapshot`() {
        val a=create();val b=create()
        val original=setting(a.id,"규칙","기본 공개 설정").settings.single()
        val d=service.edit(a.id,"author",DraftRequest("1화","발행 원고",0))
        service.publish(a.id,"author",PublishRequest(d.revision,true,true,true,service.history(a.id,"author").versions.last().id))
        foreignOnlyRange(a.id,original.id,b.id,"public")

        val fork=service.fork(a.id,"public-range-reader",ForkRequest(1,"기본 정책 승계"))
        var world=service.world(fork.id,"public-range-reader")
        val basis=world.basis!!
        assertEquals(original.versionId,basis.settings.single().versionId)
        assertEquals("public",basis.settings.single().visibility)
        assertEquals(original.versionId,world.settings.single().versionId)
        world=service.saveSetting(fork.id,original.id,"public-range-reader",SettingRequest(world.revision,world.settings.single().copy(content="독립 수정"),world.sourceToken))
        world=service.commitSetting(fork.id,original.id,"public-range-reader",world.revision)
        assertEquals("independent",world.mode)
        assertEquals("독립 수정",world.settings.single().content)
        val restored=service.world(fork.id,"public-range-reader")
        assertEquals(original.versionId,restored.basis!!.settings.single().versionId)
        assertEquals(original.versionId,jdbc.queryForObject("SELECT v.content_version_id FROM fork_source_setting s JOIN setting_version v ON v.id=s.setting_version_id WHERE s.fork_work_id=?",String::class.java,fork.id))
        assertEquals("public",jdbc.queryForObject("SELECT h.default_visibility FROM fork_source_setting s JOIN setting_version v ON v.id=s.setting_version_id JOIN setting_visibility_history h ON h.id=v.visibility_history_id WHERE s.fork_work_id=?",String::class.java,fork.id))
        assertTrue(world.changes.isEmpty())
    }

}
