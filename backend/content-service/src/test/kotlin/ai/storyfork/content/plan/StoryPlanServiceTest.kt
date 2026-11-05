package ai.storyfork.content.plan

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.plan.entity.StoryPlanEntity
import ai.storyfork.content.plan.repository.StoryPlanRepository
import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.plan.service.dto.StoryPlanRequest
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.entity.EpisodeEntity
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class StoryPlanServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val plans = mock(StoryPlanRepository::class.java)
    private val world = mock(WorldService::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val episodeService = mock(EpisodeService::class.java)
    private val service = StoryPlanService(access, plans, world, episodes, episodeService)
    private fun plot() = StoryPlanEntity(id="p", workId="w", kind="plot", title="플롯")
    private fun request(kind: String="plot", parent: String?=null, revision: Int=0) = StoryPlanRequest(kind,parent,"제목","계획",null,emptyList(),emptyList(),revision)
    private fun references() {
        val settings = listOf(SettingPayload(id="c",name="인물",category="인물"), SettingPayload(id="l",name="장소",category="장소"))
        `when`(world.read("w","owner")).thenReturn(WorldResponse("w","세계",0,"own",null,null,emptyList(),settings,settings,"token",emptyList()))
    }
    @Test fun `owner can create read update and logically delete a plot`() {
        val p=plot()
        `when`(plans.findById("p")).thenReturn(Optional.of(p))
        `when`(plans.findAllByWorkIdAndDeletedAtIsNullOrderByCreatedAtAscIdAsc("w")).thenReturn(listOf(p))
        val created=service.create("w","owner",request())
        assertEquals("plot",created.kind)
        assertEquals(1,service.list("w","owner").items.size)
        assertEquals("플롯",service.read("w","owner","p").title)
        assertEquals(1,service.update("w","owner","p",request()).revision)
        service.delete("w","owner","p",1)
        assertNotNull(p.deletedAt)
        assertEquals(404,assertThrows(ContentFailure::class.java){service.read("w","owner","p")}.status)
    }
    @Test fun `scene validates parent category and episode from the same work`() {
        references()
        `when`(plans.findById("p")).thenReturn(Optional.of(plot()))
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity("e","w",1))
        `when`(episodes.findById("e")).thenReturn(Optional.of(EpisodeEntity("e","w",1)))
        val value=request("scene","p").copy(episodeNumber=1,characterIds=listOf("c"),placeIds=listOf("l"))
        val scene=service.create("w","owner",value)
        assertEquals(listOf("c"),scene.characterIds)
        assertEquals(1,scene.episodeNumber)
        assertEquals(422,assertThrows(ContentFailure::class.java){service.create("w","owner",value.copy(characterIds=listOf("l")))}.status)
        assertEquals(422,assertThrows(ContentFailure::class.java){service.create("w","owner",value.copy(placeIds=listOf("foreign")))}.status)
        assertEquals(422,assertThrows(ContentFailure::class.java){service.create("w","owner",value.copy(episodeNumber=999))}.status)
        verify(world,times(4)).read("w","owner")
        verifyNoMoreInteractions(world)
    }
    @Test fun `foreign parent hierarchy changes and stale writes are rejected`() {
        val p=plot(); `when`(plans.findById("p")).thenReturn(Optional.of(p))
        assertEquals(404,assertThrows(ContentFailure::class.java){service.create("other","owner",request("scene","p"))}.status)
        assertEquals(422,assertThrows(ContentFailure::class.java){service.update("w","owner","p",request("scene","p"))}.status)
        p.revision=2
        assertEquals(409,assertThrows(ContentFailure::class.java){service.update("w","owner","p",request())}.status)
        assertEquals(409,assertThrows(ContentFailure::class.java){service.delete("w","owner","p",0)}.status)
        assertNull(p.deletedAt)
    }
    @Test fun `active children prevent parent deletion but deleted children do not`() {
        val p=plot(); `when`(plans.findById("p")).thenReturn(Optional.of(p))
        `when`(plans.existsByWorkIdAndParentIdAndDeletedAtIsNull("w","p")).thenReturn(true)
        assertEquals(409,assertThrows(ContentFailure::class.java){service.delete("w","owner","p",0)}.status)
        assertNull(p.deletedAt)
        `when`(plans.existsByWorkIdAndParentIdAndDeletedAtIsNull("w","p")).thenReturn(false)
        service.delete("w","owner","p",0)
        assertNotNull(p.deletedAt)
    }
    @Test fun `denied ownership prevents all data access`() {
        doThrow(ContentFailure(404,"작품을 찾을 수 없어요.")).`when`(access).own("w","other")
        assertThrows(ContentFailure::class.java){service.list("w","other")}
        assertThrows(ContentFailure::class.java){service.read("w","other","p")}
        assertThrows(ContentFailure::class.java){service.create("w","other",request())}
        assertThrows(ContentFailure::class.java){service.update("w","other","p",request())}
        assertThrows(ContentFailure::class.java){service.delete("w","other","p",0)}
        verifyNoInteractions(plans,world,episodes,episodeService)
    }
    @Test fun `missing episode never silently binds to a reused episode number`() {
        val p=plot().apply {kind="scene";parentId="parent";episodeId="removed";episodeNumber=1}
        `when`(plans.findById("p")).thenReturn(Optional.of(p))
        `when`(episodes.findById("removed")).thenReturn(Optional.empty())
        assertTrue(service.read("w","owner","p").episodeMissing)
        verify(episodes,never()).findByWorkIdAndSequence(anyString(),anyInt())
    }
    @Test fun `setting visibility placeholder cannot become a scene episode reference`() {
        `when`(plans.findById("p")).thenReturn(Optional.of(plot()))
        `when`(episodes.findByWorkIdAndSequence("w",10)).thenReturn(EpisodeEntity("placeholder","w",10))
        doThrow(ContentFailure(404,"회차를 찾을 수 없어요.")).`when`(episodeService).read("w","owner",10)
        val data=request("scene","p").copy(episodeNumber=10)
        assertEquals(422,assertThrows(ContentFailure::class.java){service.create("w","owner",data)}.status)
        verify(plans).findById("p")
        verifyNoMoreInteractions(plans)
    }
}
