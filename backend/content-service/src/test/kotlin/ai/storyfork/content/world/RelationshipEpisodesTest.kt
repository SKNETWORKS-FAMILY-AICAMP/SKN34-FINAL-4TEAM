package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.RelationEdge
import ai.storyfork.content.world.relationship.edgesAfterSave
import ai.storyfork.content.world.relationship.episodeEdges
import ai.storyfork.content.world.relationship.relationHistory
import ai.storyfork.content.world.relationship.relationsAsOf
import ai.storyfork.content.world.relationship.saveEpisode
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** DEC-51 회차별 연결의 순수 규칙이다. Neo4j 없이 시점 선택·저장 회차·변경분 계산을 확인한다. */
class RelationshipEpisodesTest {
    private val a=UUID.randomUUID();private val b=UUID.randomUUID();private val c=UUID.randomUUID()
    private val friend=UUID.randomUUID();private val rival=UUID.randomUUID();private val stay=UUID.randomUUID()

    private fun edge(id:UUID,from:Int,payload:String="p$from",source:UUID=a,target:UUID=b)=RelationEdge(id,from,false,source,target,payload)
    private fun ended(id:UUID,from:Int,source:UUID=a,target:UUID=b)=RelationEdge(id,from,true,source,target,null)

    @Test fun `as of an episode each relation shows its latest connection up to it and an ended one hides it`() {
        val rivalEdge=edge(rival,2,source=b,target=c)
        val edges=listOf(edge(friend,1),edge(friend,3),ended(friend,5),rivalEdge)
        assertEquals(setOf(edge(friend,1),rivalEdge),relationsAsOf(edges,2).toSet())
        assertEquals(setOf(edge(friend,3),rivalEdge),relationsAsOf(edges,4).toSet())
        assertEquals(setOf(rivalEdge),relationsAsOf(edges,5).toSet())
        assertEquals(setOf(rivalEdge),relationsAsOf(edges,null).toSet())
        assertTrue(relationsAsOf(edges,0).isEmpty())
    }

    @Test fun `a connection after an ended one brings the relation back`() {
        val edges=listOf(edge(friend,1),ended(friend,3),edge(friend,6))
        assertTrue(relationsAsOf(edges,4).isEmpty())
        assertEquals(listOf(edge(friend,6)),relationsAsOf(edges,7))
        assertEquals(listOf(edge(friend,6)),relationsAsOf(edges,null))
    }

    @Test fun `two connections of one relation in the same episode are a corrupt graph only when they are the latest`() {
        val twice=listOf(edge(friend,2,"first"),edge(friend,2,"second"))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { relationsAsOf(twice,null) }.code)
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { relationsAsOf(twice+edge(rival,1),2) }.code)
        assertEquals(listOf(edge(friend,3)),relationsAsOf(twice+edge(friend,3),null))
        assertTrue(relationsAsOf(twice,1).isEmpty())
    }

    @Test fun `the saved episode is the requested one, else the latest recorded one, else the first`() {
        val edges=listOf(edge(friend,1),edge(friend,3),ended(rival,5))
        assertEquals(2,saveEpisode(edges,2))
        assertEquals(7,saveEpisode(edges,7))
        assertEquals(5,saveEpisode(edges,null))
        assertEquals(1,saveEpisode(emptyList(),null))
        assertEquals(4,saveEpisode(emptyList(),4))
    }

    @Test fun `only new or changed relations are written at the episode and unchanged ones are left alone`() {
        val current=listOf(edge(friend,1,"same"),edge(rival,1,"before",source=b,target=c))
        val rows=listOf(edge(friend,3,"same"),edge(rival,3,"after",source=b,target=c))
        assertEquals(listOf(edge(rival,3,"after",source=b,target=c)),episodeEdges(current,rows,3))
        assertTrue(episodeEdges(current,listOf(edge(friend,3,"same"),edge(rival,3,"before",source=b,target=c)),3).isEmpty())
        val brandNew=UUID.randomUUID()
        assertEquals(listOf(edge(brandNew,3,"new",source=a,target=c)),episodeEdges(current,current.map { it.copy(fromEpisode=3) }+edge(brandNew,3,"new",source=a,target=c),3))
    }

    @Test fun `moving a relation to other cards is a change even when the payload text is the same`() {
        val current=listOf(edge(friend,1,"same"))
        assertEquals(listOf(edge(friend,2,"same",source=a,target=c)),episodeEdges(current,listOf(edge(friend,2,"same",source=a,target=c)),2))
    }

    @Test fun `a relation missing from the rows gets an ended connection with its old cards and no payload`() {
        val current=listOf(edge(friend,1),edge(rival,2,source=b,target=c))
        assertEquals(listOf(ended(rival,4,source=b,target=c)),episodeEdges(current,listOf(edge(friend,4,"p1")),4))
        assertEquals(setOf(ended(friend,4),ended(rival,4,source=b,target=c)),episodeEdges(current,emptyList(),4).toSet())
        assertTrue(episodeEdges(emptyList(),emptyList(),4).isEmpty())
    }

    @Test fun `every written connection carries the saved episode`() {
        val current=listOf(edge(friend,1),edge(rival,2,source=b,target=c))
        val written=episodeEdges(current,listOf(edge(UUID.randomUUID(),9,"new"),edge(friend,9,"changed")),9)
        assertEquals(3,written.size)
        assertEquals(setOf(9),written.map { it.fromEpisode }.toSet())
    }

    // --- 저장한 뒤의 연결(쓰지 않고 계산): 「동일 인물」의 사슬·순환은 저장 결과의 최신 시점으로 본다(#485) ---
    @Test fun `the latest view after a save at the latest episode is the saved list`() {
        val edges=listOf(edge(friend,1,"old"),edge(rival,1,"keep",source=b,target=c))
        val after=relationsAsOf(edgesAfterSave(edges,listOf(edge(friend,1,"new"),edge(rival,1,"keep",source=b,target=c)),null),null)
        assertEquals(setOf(edge(friend,1,"new"),edge(rival,1,"keep",source=b,target=c)),after.toSet())
    }
    @Test fun `a save at an earlier episode does not change what a later connection already decides for the latest view`() {
        val edges=listOf(edge(friend,1,"early"),edge(friend,5,"later",source=a,target=c),edge(rival,1,"x",source=b,target=c),ended(rival,5,source=b,target=c))
        val after=relationsAsOf(edgesAfterSave(edges,listOf(edge(friend,2,"rewritten"),edge(rival,2,"rewritten",source=b,target=c)),2),null)
        assertEquals(listOf(edge(friend,5,"later",source=a,target=c)),after) // 최신 시점은 5화 연결이 정한다: 친구는 옮겨진 채, 라이벌은 끝난 채다
    }
    @Test fun `a relation first written at an earlier episode shows in the latest view`() {
        val brandNew=UUID.randomUUID()
        val edges=listOf(edge(friend,1),edge(friend,5,"later",source=a,target=c))
        val after=relationsAsOf(edgesAfterSave(edges,listOf(edge(friend,2,"p1"),edge(brandNew,2,"new",source=b,target=c)),2),null)
        assertEquals(setOf(edge(friend,5,"later",source=a,target=c),edge(brandNew,2,"new",source=b,target=c)),after.toSet())
    }
    @Test fun `ending a relation at an earlier episode leaves it as it is when a later connection brought it back`() {
        val edges=listOf(edge(friend,1),edge(friend,6,"back"))
        val after=relationsAsOf(edgesAfterSave(edges,emptyList(),3),null)
        assertEquals(listOf(edge(friend,6,"back")),after)
    }

    @Test fun `a row with its own episode is compared with the relation as of that episode and written at it`() {
        val edges=listOf(edge(friend,1,"early"),edge(friend,3,"later"))
        assertTrue(episodeEdges(edges,listOf(edge(friend,2,"early")),5).isEmpty()) // 2화 시점의 값과 같으면 쓰지 않는다
        assertEquals(listOf(edge(friend,2,"new")),episodeEdges(edges,listOf(edge(friend,2,"new")),5)) // 다르면 2화 연결로 쓰고 3화 연결은 건드리지 않는다
    }
    @Test fun `rows are written at their own episode while left out relations end at the saved one`() {
        val edges=listOf(edge(friend,1),edge(rival,1,source=b,target=c),edge(stay,1,"stay",a,c))
        val written=episodeEdges(edges,listOf(edge(friend,7,"changed"),edge(rival,4,"changed",source=b,target=c)),4)
        assertEquals(setOf(edge(friend,7,"changed"),edge(rival,4,"changed",source=b,target=c),ended(stay,4,source=a,target=c)),written.toSet())
    }
    @Test fun `a relation first written at a later episode is new for the earlier episodes`() {
        val brandNew=UUID.randomUUID()
        assertEquals(listOf(edge(brandNew,6,"new",a,c)),episodeEdges(listOf(edge(friend,1)),listOf(edge(friend,3,"p1"),edge(brandNew,6,"new",a,c)),3))
    }
    @Test fun `after a save with per-relation episodes only the same relation in the same episode is overwritten`() {
        val edges=listOf(edge(friend,1,"a"),edge(friend,3,"b"),edge(friend,6,"c"))
        assertEquals(setOf(edge(friend,1,"a"),edge(friend,3,"b2"),edge(friend,6,"c")),edgesAfterSave(edges,listOf(edge(friend,3,"b2")),null).toSet())
        assertEquals(edges.toSet(),edgesAfterSave(edges,listOf(edge(friend,3,"b")),null).toSet()) // 3화 시점과 같은 값이면 그대로다
    }

    // --- 회차 이력(DEC-54): 공개 응답이 담는 기준 회차까지의 변화 ---
    @Test fun `history lists the changes up to the episode, only for relations that changed, and never what comes after`() {
        val edges=listOf(edge(friend,1,"a"),edge(friend,3,"b"),edge(friend,8,"c"),edge(rival,2,"x",b,c))
        assertEquals(listOf(edge(friend,1,"a"),edge(friend,3,"b")),relationHistory(edges,4)[friend])
        assertEquals(listOf(1,3,8),relationHistory(edges,null)[friend]!!.map { it.fromEpisode })
        assertNull(relationHistory(edges,2)[friend]) // 연결이 하나뿐이면 바뀐 적이 없다
        assertNull(relationHistory(edges,null)[rival])
        assertEquals(listOf(1,3),relationHistory(edges,5)[friend]!!.map { it.fromEpisode }) // 기준 회차(5화) 뒤의 8화 연결은 담지 않는다
    }
    @Test fun `history restarts after an ending and leaves out relations that are ended at the episode`() {
        val edges=listOf(edge(friend,1,"a"),edge(friend,3,"b"),ended(friend,5),edge(friend,8,"c"),edge(friend,9,"d"))
        assertEquals(listOf(1,3),relationHistory(edges,4)[friend]!!.map { it.fromEpisode })
        assertNull(relationHistory(edges,6)[friend]) // 5화에 끝난 관계는 그 시점에 없다
        assertNull(relationHistory(edges,8)[friend]) // 다시 이은 뒤 연결이 하나뿐이다
        assertEquals(listOf(8,9),relationHistory(edges,null)[friend]!!.map { it.fromEpisode })
    }
    @Test fun `history never reaches back past a connection with other cards`() {
        // 1화에는 a→c였던 관계(c는 작가 전용 카드일 수 있다)가 3화에 a→b로 옮겨졌다. 지금 두 카드(a→b)의 이력에 1화의 옛 끝점 연결이 실리면 안 된다.
        val edges=listOf(edge(friend,1,"lover",a,c),edge(friend,3,"friend"),edge(friend,5,"ally"))
        assertEquals(listOf(3,5),relationHistory(edges,null)[friend]!!.map { it.fromEpisode })
        assertNull(relationHistory(edges,4)[friend]) // 지금 끝점으로는 3화 연결 하나뿐이라 바뀐 적이 없다
        assertEquals(listOf(1,2),relationHistory(listOf(edge(friend,1,"lover",a,c),edge(friend,2,"lover2",a,c),edge(friend,3,"friend")),2)[friend]!!.map { it.fromEpisode }) // 그 시점의 끝점이 같은 구간은 이력이다
    }
    @Test fun `swapping the two cards ends the history run too`() {
        val edges=listOf(edge(friend,1,"p"),edge(friend,3,"q",b,a),edge(friend,4,"r",b,a))
        assertEquals(listOf(3,4),relationHistory(edges,null)[friend]!!.map { it.fromEpisode })
        assertNull(relationHistory(edges,2)[friend])
    }
    @Test fun `a stale duplicate of an earlier episode does not cut the history, the later connection of that episode wins`() {
        // 같은 관계·같은 회차의 연결이 둘인 손상된 그래프(2화 a→c, a→b)에서도 회차마다 뒤의 연결만 남긴 뒤 구간을 잡는다: 1화 a→b부터 이어진다.
        val edges=listOf(edge(friend,1,"p1"),edge(friend,2,"stale",a,c),edge(friend,2,"p2"),edge(friend,3,"p3"))
        assertEquals(listOf("p1","p2","p3"),relationHistory(edges,null)[friend]!!.map { it.payload })
    }
}
