package ai.storyfork.content.world.relationship

import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.RelationshipStateResult
import java.time.Duration
import java.util.UUID
import org.neo4j.driver.Driver
import org.neo4j.driver.SessionConfig
import org.neo4j.driver.TransactionConfig
import org.neo4j.driver.TransactionContext
import org.neo4j.driver.exceptions.Neo4jException
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Repository
import tools.jackson.databind.json.JsonMapper

/** Neo4j 한 트랜잭션에서 현재 관계 전체를 CAS 교체한다. payload 이력·버전 노드는 만들지 않는다. */
@Repository
class Neo4jRelationshipRepository(private val driver:Driver,private val mapper:JsonMapper,
    @Value("\${app.worldstudio.neo4j.database:neo4j}") private val database:String) {
    @Volatile private var schemaReady=false
    private val timeout=TransactionConfig.builder().withTimeout(Duration.ofSeconds(5)).build()

    fun read(worldId:UUID):RelationshipStateResult=access {
        driver.session(SessionConfig.forDatabase(database)).use { session -> session.executeRead({ tx -> read(tx,worldId) },timeout) }
    }

    fun replace(worldId:UUID,expected:Long,key:String,hash:String,rows:List<RelationshipPayload>):RelationshipStateResult=access {
        ensureSchema()
        driver.session(SessionConfig.forDatabase(database)).use { session -> session.executeWrite({ tx ->
            val params=mapOf("world" to worldId.toString())
            if(expected==-1L) tx.run("MERGE (w:StudioRelationshipWorld {id: \$world}) ON CREATE SET w.version=-1, w.requestKey='', w.requestHash='', w.count=0",params).consume()
            // A dependent write takes Neo4j's node lock before checking the CAS token.
            tx.run("MATCH (w:StudioRelationshipWorld {id: \$world}) SET w.mutex=coalesce(w.mutex,0)+1",params).consume()
            val current=read(tx,worldId)
            if(current.version==Math.incrementExact(expected) && current.key==key && current.hash==hash) return@executeWrite current
            if(current.version!=expected) throw WorldStudioFailure.mismatch()
            val ids=rows.map { it.id.toString() }
            val cardIds=rows.flatMap { listOfNotNull(it.sourceCardId,it.targetCardId) }.distinct().map { it.toString() }
            val checks=params+mapOf("ids" to ids,"cards" to cardIds)
            // MERGE plus a dependent write locks identities before checking ownership, including racing worlds.
            for((label,parameter) in listOf("StudioRelationship" to "ids","StudioCard" to "cards")) {
                val foreign=tx.run("""UNWIND ${'$'}$parameter AS id MERGE (n:$label {id:id})
                    ON CREATE SET n.worldId=${'$'}world SET n.mutex=coalesce(n.mutex,0)+1
                    WITH n WHERE n.worldId <> ${'$'}world RETURN count(n) AS n""",checks).single()["n"].asLong()
                if(foreign!=0L) throw WorldNotFound()
            }
            // Removed content is erased; bare logical-ID reservations are not relationship history.
            tx.run("""MATCH (w:StudioRelationshipWorld {id: ${'$'}world})-[link:HAS_RELATION]->(r:StudioRelationship)
                OPTIONAL MATCH (r)-[endpoint:SOURCE|TARGET]->() DELETE endpoint,link SET r.payload=null""",params).consume()
            val values=rows.map { mapOf("id" to it.id.toString(),"payload" to mapper.writeValueAsString(it),"source" to it.sourceCardId?.toString(),"target" to it.targetCardId?.toString()) }
            tx.run("""MATCH (w:StudioRelationshipWorld {id: ${'$'}world}) UNWIND ${'$'}rows AS row
                MATCH (r:StudioRelationship {id:row.id})
                SET r.payload=row.payload MERGE (w)-[:HAS_RELATION]->(r)
                FOREACH (_ IN CASE WHEN row.source IS NULL THEN [] ELSE [1] END |
                    MERGE (c:StudioCard {id:row.source}) MERGE (r)-[:SOURCE]->(c))
                FOREACH (_ IN CASE WHEN row.target IS NULL THEN [] ELSE [1] END |
                    MERGE (c:StudioCard {id:row.target}) MERGE (r)-[:TARGET]->(c))""",params+mapOf("rows" to values)).consume()
            tx.run("""MATCH (w:StudioRelationshipWorld {id: ${'$'}world})
                SET w.version=${'$'}version,w.requestKey=${'$'}key,w.requestHash=${'$'}hash,w.count=${'$'}count""",
                params+mapOf("version" to Math.incrementExact(expected),"key" to key,"hash" to hash,"count" to rows.size)).consume()
            read(tx,worldId)
        },timeout) }
    }

    private fun read(tx:TransactionContext,worldId:UUID):RelationshipStateResult {
        val result=tx.run("""MATCH (w:StudioRelationshipWorld {id: ${'$'}world})
            OPTIONAL MATCH (w)-[:HAS_RELATION]->(r:StudioRelationship)
            RETURN w.version AS version,w.requestKey AS key,w.requestHash AS hash,w.count AS count,collect(r.payload) AS payloads""",mapOf("world" to worldId.toString()))
        if(!result.hasNext()) throw WorldStudioFailure.mismatch()
        val row=result.single()
        val payloads=try { row["payloads"].asList { mapper.readValue(it.asString(),RelationshipPayload::class.java) } }
            catch(_:RuntimeException) { throw WorldStudioFailure.mismatch() }
        if(row["count"].asLong()!=payloads.size.toLong() || payloads.map { it.id }.distinct().size!=payloads.size) throw WorldStudioFailure.mismatch()
        return RelationshipStateResult(worldId,row["version"].asLong(),row["key"].asString(),row["hash"].asString(),payloads.sortedBy { it.id.toString() })
    }
    @Synchronized private fun ensureSchema() {
        if(schemaReady) return
        driver.session(SessionConfig.forDatabase(database)).use { session ->
            for(label in listOf("StudioRelationshipWorld","StudioRelationship","StudioCard"))
                session.run("CREATE CONSTRAINT ${label.lowercase()}_id IF NOT EXISTS FOR (n:$label) REQUIRE n.id IS UNIQUE").consume()
        }
        schemaReady=true
    }
    private fun <T> access(action:()->T):T=try { action() } catch(_:Neo4jException) { throw WorldStudioFailure.unavailable() }
}
