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

    @Test fun `scene order is persisted across plots and shifted revisions reject stale edits`() {
        val parent=plot()
        val a=StoryPlanEntity(id="a",workId="w",kind="scene",parentId="p",episodeNumber=1,episodeId="e",position=0)
        val b=StoryPlanEntity(id="b",workId="w",kind="scene",parentId="q",episodeNumber=1,episodeId="e",position=1)
        val other=StoryPlanEntity(id="other",workId="w",kind="scene",parentId="p",episodeNumber=2,position=0)
        `when`(plans.findById("a")).thenReturn(Optional.of(a))
        `when`(plans.findById("b")).thenReturn(Optional.of(b))
        `when`(plans.findById("p")).thenReturn(Optional.of(parent))
        `when`(plans.findById("q")).thenReturn(Optional.of(plot().apply {id="q"}))
        `when`(plans.findAllByWorkIdAndDeletedAtIsNullOrderByCreatedAtAscIdAsc("w")).thenReturn(listOf(parent,a,b,other))
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity("e","w",1))
        `when`(episodes.findById("e")).thenReturn(Optional.of(EpisodeEntity("e","w",1)))
        val moved=service.update("w","owner","b",request("scene","q").copy(episodeNumber=1,position=0))
        assertEquals(0,moved.position)
        assertEquals(1,a.position)
        assertEquals(1,a.revision)
        assertEquals(0,other.position)
        assertEquals(0,other.revision)
        assertEquals(listOf("b","a"),service.list("w","owner").items.filter {it.episodeNumber==1}.map {it.id})
        assertEquals(409,assertThrows(ContentFailure::class.java){service.update("w","owner","a",request("scene","p").copy(episodeNumber=1))}.status)
        assertEquals(422,assertThrows(ContentFailure::class.java){service.update("w","owner","b",request("scene","q",1).copy(episodeNumber=1,position=9))}.status)
    }

    @Test fun `scenes left on a deleted episode with the same number do not shift move targets`() {
        val stale=StoryPlanEntity(id="x",workId="w",kind="scene",parentId="p",episodeNumber=1,episodeId="old",position=0)
        val a=StoryPlanEntity(id="a",workId="w",kind="scene",parentId="p",episodeNumber=1,episodeId="e",position=1)
        val b=StoryPlanEntity(id="b",workId="w",kind="scene",parentId="p",episodeNumber=1,episodeId="e",position=2)
        `when`(plans.findById("a")).thenReturn(Optional.of(a))
        `when`(plans.findById("p")).thenReturn(Optional.of(plot()))
        `when`(plans.findAllByWorkIdAndDeletedAtIsNullOrderByCreatedAtAscIdAsc("w")).thenReturn(listOf(stale,a,b))
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity("e","w",1))
        `when`(episodes.findById("e")).thenReturn(Optional.of(EpisodeEntity("e","w",1)))
        // 화면은 끊긴 장면 x를 빼고 [a,b]로 보므로 a를 아래로 옮기면 목적지 1을 보낸다.
        service.update("w","owner","a",request("scene","p").copy(episodeNumber=1,position=1))
        assertEquals(listOf(0,1),listOf(b.position,a.position))
        assertEquals(0,stale.revision)
    }

    @Test fun `editing content preserves relative order after deletion gaps`() {
        val a=StoryPlanEntity(id="a",workId="w",kind="scene",parentId="p",position=2)
        val b=StoryPlanEntity(id="b",workId="w",kind="scene",parentId="p",position=3)
        `when`(plans.findById("a")).thenReturn(Optional.of(a))
        `when`(plans.findById("p")).thenReturn(Optional.of(plot()))
        `when`(plans.findAllByWorkIdAndDeletedAtIsNullOrderByCreatedAtAscIdAsc("w")).thenReturn(listOf(a,b))
        service.update("w","owner","a",request("scene","p"))
        assertEquals(listOf("a","b"),service.list("w","owner").items.map {it.id})
    }
}
