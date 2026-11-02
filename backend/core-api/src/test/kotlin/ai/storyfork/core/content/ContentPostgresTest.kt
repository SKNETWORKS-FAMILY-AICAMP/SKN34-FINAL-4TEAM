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

@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest(properties=["app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","CONTENT_DATABASE_USER=content_test","CONTENT_DATABASE_PASSWORD="])
class ContentPostgresTest {
    @Autowired lateinit var service: ContentService
    @MockitoBean lateinit var ai: GenerationClient
    private fun create() = service.create("author",CreateWorkRequest("통합 검증 "+contentId()))
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
        val published=service.publish(w.id,"author",PublishRequest(d.revision,true,true,true))
        assertEquals(1,published.episodes.size)
        assertNull(service.publicRead(w.id).draft)
        assertEquals(1,service.history(w.id,"author").versions.size)
    }
    @Test fun `fork follows detaches and applies only selected source corrections`() {
        val w=create(); val world=setting(w.id,"규칙","처음")
        setting(w.id,"비밀","SECRET",false); setting(w.id,"미래","FUTURE",at=4)
        val d=service.edit(w.id,"author",DraftRequest("1화","공개 원고",0))
        service.publish(w.id,"author",PublishRequest(d.revision,true,true,true))
        val fork=service.fork(w.id,"reader",ForkRequest(1,"분기"))
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
