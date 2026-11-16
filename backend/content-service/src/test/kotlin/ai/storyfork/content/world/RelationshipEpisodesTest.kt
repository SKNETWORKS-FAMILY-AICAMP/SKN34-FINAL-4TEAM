package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.RelationEdge
import ai.storyfork.content.world.relationship.episodeEdges
import ai.storyfork.content.world.relationship.relationsAsOf
import ai.storyfork.content.world.relationship.saveEpisode
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** DEC-51 회차별 연결의 순수 규칙이다. Neo4j 없이 시점 선택·저장 회차·변경분 계산을 확인한다. */
class RelationshipEpisodesTest {
    private val a=UUID.randomUUID();private val b=UUID.randomUUID();private val c=UUID.randomUUID()
    private val friend=UUID.randomUUID();private val rival=UUID.randomUUID()

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
}
