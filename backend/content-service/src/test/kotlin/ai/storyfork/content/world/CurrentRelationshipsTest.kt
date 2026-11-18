package ai.storyfork.content.world

import ai.storyfork.content.world.helper.RelationshipInputHelper
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RelationshipInputHelperTest {
    private val a=UUID.randomUUID()
    private val b=UUID.randomUUID()
    private val first=RelationshipPayload(UUID.randomUUID(),a,b,"structural","오랜 친구",label="friend_of",direction="symmetric",polarity="asserted")
    private val second=RelationshipPayload(UUID.randomUUID(),b,a,"emotional","경계한다",label="wary_of",direction="directed",polarity="denied")

    @Test fun `removing and adding a relationship at the limit keeps ten thousand active`() {
        val current=(1..10000).map { first.copy(id=UUID.randomUUID()) }
        val added=second.copy(id=UUID.randomUUID())
        val updates=listOf(current.first().copy(lifecycle="removed",sourceCardId=null,targetCardId=null),added)
        val result=assertDoesNotThrow<List<RelationshipPayload>> { RelationshipInputHelper.merge(current,updates,false,setOf(a,b)) }
        assertEquals(current.drop(1)+added,result)
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(current,listOf(added),false,setOf(a,b)) }
        assertEquals(current.first().copy(body="변경"),RelationshipInputHelper.merge(current,listOf(current.first().copy(body="변경")),false,setOf(a,b)).first())
        assertEquals(listOf(added),RelationshipInputHelper.merge(current,updates,true,setOf(a,b)))
        assertEquals(10000,current.size)
        assertDoesNotThrow { RelationshipInputHelper.validateSnapshot(current,setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.validateSnapshot(current + current.first(),setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.validateSnapshot(current,setOf(a)) }
    }
    @Test fun `request limit and removed payload validation cannot be bypassed`() {
        val updates=(1..1001).map { first.copy(id=UUID.randomUUID(),lifecycle="removed",sourceCardId=null,targetCardId=null) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),updates,false,setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first.copy(lifecycle="removed",targetCardId=a)),false,setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first.copy(lifecycle="removed",direction="unknown")),false,setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first.copy(lifecycle="unknown")),false,setOf(a,b)) }
    }
    @Test fun `replace preserves IDs descriptions directions and multiple relations without keeping removed history`() {
        val result=RelationshipInputHelper.merge(listOf(first,second),listOf(first.copy(body="지금은 동료")),true,setOf(a,b))
        assertEquals(listOf(first.copy(body="지금은 동료")),result)
        assertEquals(listOf(first,second),RelationshipInputHelper.merge(listOf(first),listOf(second),false,setOf(a,b)))
        assertTrue(RelationshipInputHelper.merge(listOf(first),emptyList(),true,setOf(a,b)).isEmpty())
    }
    @Test fun `a relationship needs both cards and cannot reference a different world or itself`() {
        // DEC-51: 연결은 두 카드 사이에만 있어 끝이 비어 있는 관계는 저장할 수 없다. 삭제 표시(removed)는 현재 관계에서 빠질 뿐이라 끝이 비어도 된다.
        val incomplete=RelationshipPayload(UUID.randomUUID(),a,null,null)
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(incomplete),true,setOf(a)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(incomplete.copy(sourceCardId=null,targetCardId=b)),true,setOf(b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(listOf(incomplete),emptyList(),false,setOf(a)) }
        assertTrue(RelationshipInputHelper.merge(emptyList(),listOf(incomplete.copy(lifecycle="removed")),true,setOf(a)).isEmpty())
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first),true,setOf(a)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first.copy(targetCardId=a)),true,setOf(a)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first,first),true,setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first.copy(direction="unknown")),true,setOf(a,b)) }
        assertThrows(IllegalArgumentException::class.java) { RelationshipInputHelper.merge(emptyList(),listOf(first.copy(polarity="unknown")),true,setOf(a,b)) }
    }
}
