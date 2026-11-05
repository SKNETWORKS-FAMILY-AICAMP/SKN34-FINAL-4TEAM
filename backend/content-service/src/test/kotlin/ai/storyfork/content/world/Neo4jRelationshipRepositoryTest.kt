package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.relationship.Neo4jRelationshipConfig
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.RelationshipStateResult
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.neo4j.driver.*
import org.neo4j.driver.exceptions.ServiceUnavailableException
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class Neo4jRelationshipRepositoryTest {
    private val driver=mock(Driver::class.java)
    private val session=mock(Session::class.java)
    private val tx=mock(TransactionContext::class.java)
    private val result=mock(Result::class.java)
    private val row=mock(org.neo4j.driver.Record::class.java)
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val repository=Neo4jRelationshipRepository(driver,mapper,"neo4j")
    private val world=UUID.randomUUID()
    private fun answer(payloads:List<String>,count:Int=payloads.size) {
        `when`(driver.session(any(SessionConfig::class.java))).thenReturn(session)
        doAnswer { it.getArgument<TransactionCallback<RelationshipStateResult>>(0).execute(tx) }.`when`(session).executeRead<RelationshipStateResult>(any(),any(TransactionConfig::class.java))
        `when`(tx.run(anyString(),anyMap<String,Any>())).thenReturn(result)
        `when`(result.hasNext()).thenReturn(true);`when`(result.single()).thenReturn(row)
        for((key,value) in mapOf("version" to 4,"key" to "request","hash" to "hash","count" to count,"payloads" to payloads))
            `when`(row[key]).thenReturn(Values.value(value))
    }
    @Test fun `current relationships preserve stable IDs multiple edges body direction and polarity`() {
        val a=UUID.randomUUID();val b=UUID.randomUUID()
        val relations=listOf(RelationshipPayload(UUID.randomUUID(),a,b,"emotional","신뢰하면서 경계\n원문",direction="directed",polarity="denied"),
            RelationshipPayload(UUID.randomUUID(),a,b,"structural","형제",direction="symmetric"))
        answer(relations.map(mapper::writeValueAsString))
        assertEquals(relations.sortedBy { it.id.toString() },repository.read(world).relationships)
        verify(tx).run(contains("${'$'}world"),eq(mapOf("world" to world.toString())))
        verify(session).close()
    }
    @Test fun `missing or corrupt current graph is an explicit failure not an empty success`() {
        answer(emptyList(),1)
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { repository.read(world) }.code)
        `when`(result.hasNext()).thenReturn(false)
        assertThrows(WorldStudioFailure::class.java) { repository.read(world) }
    }
    @Test fun `foreign identity rejection escapes the graph callback before any payload replacement`() {
        answer(emptyList())
        `when`(session.run(anyString())).thenReturn(result)
        doAnswer { it.getArgument<TransactionCallback<RelationshipStateResult>>(0).execute(tx) }.`when`(session).executeWrite<RelationshipStateResult>(any(),any(TransactionConfig::class.java))
        `when`(row["n"]).thenReturn(Values.value(1))
        val relation=RelationshipPayload(UUID.randomUUID(),null,null,"emotional","foreign")
        assertThrows(WorldNotFound::class.java) { repository.replace(world,4,"new","hash",listOf(relation)) }
        verify(tx,never()).run(contains("DELETE endpoint,link"),anyMap<String,Any>())
        verify(tx,never()).run(contains("SET r.payload=row.payload"),anyMap<String,Any>())
        verify(session,times(2)).close()
    }
    @Test fun `invalid connection URIs never expose credentials or parsing causes`() {
        for(uri in listOf("bolt://neo4j:configuration-secret@bad host:7687","bolt://neo4j:configuration-secret@localhost:7687")) {
            val error=assertThrows(IllegalArgumentException::class.java) { Neo4jRelationshipConfig().relationshipDriver(uri,"neo4j","password") }
            assertFalse(error.toString().contains("configuration-secret"));assertNull(error.cause)
        }
    }
    @Test fun `driver failures never expose URI credentials query or payload`() {
        `when`(driver.session(any(SessionConfig::class.java))).thenThrow(ServiceUnavailableException("bolt://secret private manuscript"))
        val error=assertThrows(WorldStudioFailure::class.java) { repository.read(world) }
        assertEquals("RELATIONSHIP_STORE_UNAVAILABLE",error.code);assertFalse(error.toString().contains("secret"));assertNull(error.cause)
    }
}
