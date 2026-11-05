package ai.storyfork.content.plan

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.plan.service.dto.StoryPlanRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.bean.override.mockito.MockitoBean

/** CI 전용 임시 PostgreSQL에서 계획 저장·권한·참조·논리 삭제를 검증한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest(properties=["app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","CONTENT_DATABASE_USER=\${TEST_CONTENT_DATABASE_USER:content_test}","CONTENT_DATABASE_PASSWORD=\${TEST_CONTENT_DATABASE_PASSWORD:}"])
class StoryPlanPostgresTest {
    @MockitoBean lateinit var auth: ai.storyfork.content.auth.client.CoreAuthClient
    @MockitoBean lateinit var ai: ai.storyfork.content.proposal.client.GenerationClient
    @Autowired lateinit var plans: StoryPlanService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var world: WorldService

    @ParameterizedTest
    @ValueSource(strings=["인물","장소"])
    fun `reference lists can remove the first of three and swap survivors without losing data`(category: String) {
        val owner="plan-reference-owner"
        val work=works.create(owner,CreateWorkRequest("참조 선택 해제 회귀"))
        var current=world.read(work.id,owner)
        val ids=(1..3).map { index ->
            val draft=world.saveDraft(work.id,"new",owner,SettingRequest(current.revision,
                SettingPayload(name="$category $index",content="보존할 설정",category=category),current.sourceToken))
            val id=draft.drafts.single().id
            current=world.commit(work.id,id,owner,draft.revision)
            id
        }
        val before=works.read(work.id,owner).draft
        val plot=plans.create(work.id,owner,StoryPlanRequest("plot",title="참조 플롯"))
        fun input(refs: List<String>, revision: Int = 0) = StoryPlanRequest("scene",plot.id,"참조 장면",
            characterIds=if(category=="인물") refs else emptyList(),
            placeIds=if(category=="장소") refs else emptyList(),revision=revision)
        val scene=plans.create(work.id,owner,input(ids))
        val shortened=plans.update(work.id,owner,scene.id,input(ids.drop(1),scene.revision))
        val reordered=plans.update(work.id,owner,scene.id,input(ids.drop(1).reversed(),shortened.revision))
        val stored=plans.read(work.id,owner,scene.id)
        assertEquals(ids.drop(1).reversed(),if(category=="인물") stored.characterIds else stored.placeIds)
        assertEquals(reordered,stored)
        assertEquals(422,assertThrows(ContentFailure::class.java) {
            plans.update(work.id,owner,scene.id,input(listOf(ids[1],ids[1]),stored.revision))
        }.status)
        assertEquals(stored,plans.read(work.id,owner,scene.id))
        assertEquals(current,world.read(work.id,owner))
        assertEquals(before,works.read(work.id,owner).draft)
    }

    @Test fun `deleting a work also removes its active and logically deleted plans`() {
        val owner="plan-delete-owner"
        val work=works.create(owner,CreateWorkRequest("작품 삭제 회귀"))
        val removed=plans.create(work.id,owner,StoryPlanRequest("plot",title="삭제한 계획"))
        plans.delete(work.id,owner,removed.id,removed.revision)
        val plot=plans.create(work.id,owner,StoryPlanRequest("plot",title="남은 계획"))
        plans.create(work.id,owner,StoryPlanRequest("scene",plot.id,"남은 장면",episodeNumber=1))
        works.delete(work.id,owner)
        assertEquals(404,assertThrows(ContentFailure::class.java){works.read(work.id,owner)}.status)
    }

    @Test fun `persisted references retain world and manuscript and reject stale or foreign access`() {
        val work=works.create("plan-owner",CreateWorkRequest("플롯 통합 검증"))
        val before=works.read(work.id,"plan-owner")
        val initial=world.read(work.id,"plan-owner")
        val draft=world.saveDraft(work.id,"new","plan-owner",SettingRequest(initial.revision,SettingPayload(name="리안",content="인물 설정",category="인물"),initial.sourceToken))
        val setting=draft.drafts.single()
        val confirmed=world.commit(work.id,setting.id,"plan-owner",draft.revision)
        val plot=plans.create(work.id,"plan-owner",StoryPlanRequest("plot",title="귀환"))
        val input=StoryPlanRequest("scene",plot.id,"탑에 돌아오다","계획 내용",1,listOf(setting.id))
        val scene=plans.create(work.id,"plan-owner",input)
        assertEquals(listOf(setting.id),plans.read(work.id,"plan-owner",scene.id).characterIds)
        assertEquals(1,plans.read(work.id,"plan-owner",scene.id).episodeNumber)
        assertEquals(2,plans.list(work.id,"plan-owner").items.size)
        assertEquals(confirmed,world.read(work.id,"plan-owner"))
        assertEquals(before.draft,works.read(work.id,"plan-owner").draft)
        assertEquals(404,assertThrows(ContentFailure::class.java){plans.read(work.id,"other",scene.id)}.status)
        val changed=plans.update(work.id,"plan-owner",scene.id,input.copy(title="수정한 장면",revision=scene.revision))
        assertEquals(409,assertThrows(ContentFailure::class.java){plans.update(work.id,"plan-owner",scene.id,input.copy(revision=scene.revision))}.status)
        assertEquals(409,assertThrows(ContentFailure::class.java){plans.delete(work.id,"plan-owner",plot.id,plot.revision)}.status)
        plans.delete(work.id,"plan-owner",scene.id,changed.revision)
        assertEquals(404,assertThrows(ContentFailure::class.java){plans.read(work.id,"plan-owner",scene.id)}.status)
        plans.delete(work.id,"plan-owner",plot.id,plot.revision)
        assertTrue(plans.list(work.id,"plan-owner").items.isEmpty())
        assertEquals(confirmed,world.read(work.id,"plan-owner"))
    }
}
