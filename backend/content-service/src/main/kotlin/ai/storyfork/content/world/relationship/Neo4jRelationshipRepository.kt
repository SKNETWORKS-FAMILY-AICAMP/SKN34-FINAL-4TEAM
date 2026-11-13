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

/**
 * Neo4j 한 트랜잭션에서 관계를 회차별 연결 `(:StudioCard)-[:RELATED {relationId, worldId, fromEpisode, ended, payload}]->(:StudioCard)`로 CAS 기록한다(DEC-51).
 * 시점 조회·저장 회차·변경분 계산은 순수 함수([relationsAsOf]·[saveEpisode]·[episodeEdges])가 하고 여기서는 읽고 쓰기만 한다.
 * 세계관 노드(`StudioRelationshipWorld`)의 token·요청 key/hash·잠금은 #132 그대로다. 노드 `count`는 이 세계관의 RELATED 연결 수(종료 연결 포함)이며
 * 읽을 때마다 실제 연결 수와 맞는지 본다. 아직 연결로 옮기지 않은 기존(StudioRelationship) 세계관이 빈 관계 성공으로 보이지 않고 불일치로 드러난다.
 *
 * ponytail: RELATED에는 관계 인덱스가 없어 세계관 조회와 관계 ID 확인이 모든 RELATED 연결을 훑는다. 느려지면 `RELATED(worldId)`·`RELATED(relationId)` 인덱스를 [ensureSchema]에 둔다.
 * 관계 ID는 노드가 없어 두 세계관이 같은 새 ID를 동시에 처음 쓰는 경합까지는 잠그지 못한다(이미 커밋된 다른 세계관의 ID는 막는다). 카드는 노드 잠금으로 막는다.
 */
@Repository
class Neo4jRelationshipRepository(private val driver:Driver,private val mapper:JsonMapper,
    @Value("\${app.worldstudio.neo4j.database:neo4j}") private val database:String) {
    @Volatile private var schemaReady=false
    private val timeout=TransactionConfig.builder().withTimeout(Duration.ofSeconds(5)).build()

    /** [episode]화 시점의 관계다. null이면 최신(관계마다 가장 최근 연결)이다. */
    fun read(worldId:UUID,episode:Int?=null):RelationshipStateResult=access {
        driver.session(SessionConfig.forDatabase(database)).use { session -> session.executeRead({ tx -> view(worldId,load(tx,worldId),episode) },timeout) }
    }

    /**
     * [rows]는 저장 회차 시점의 관계 전체다. 저장 회차는 [episode], 없으면 이 세계관의 마지막 연결 회차(연결이 없으면 1화)이며 그 시점 값과 비교해
     * 바뀐 관계만 그 회차의 연결로 쓰고 빠진 관계는 종료 연결을 쓴다. 저장 회차보다 뒤 회차의 연결은 건드리지 않는다.
     */
    fun replace(worldId:UUID,expected:Long,key:String,hash:String,rows:List<RelationshipPayload>,episode:Int?=null):RelationshipStateResult=access {
        ensureSchema()
        driver.session(SessionConfig.forDatabase(database)).use { session -> session.executeWrite({ tx ->
            val params=mapOf("world" to worldId.toString())
            if(expected==-1L) tx.run("MERGE (w:StudioRelationshipWorld {id: \$world}) ON CREATE SET w.version=-1, w.requestKey='', w.requestHash='', w.count=0",params).consume()
            // A dependent write takes Neo4j's node lock before checking the CAS token.
            tx.run("MATCH (w:StudioRelationshipWorld {id: \$world}) SET w.mutex=coalesce(w.mutex,0)+1",params).consume()
            val current=load(tx,worldId)
            if(current.version==Math.incrementExact(expected) && current.key==key && current.hash==hash) return@executeWrite view(worldId,current,episode)
            if(current.version!=expected) throw WorldStudioFailure.mismatch()
            // 끝이 빈 관계는 RelationshipInputHelper가 저장 전에 거절하므로 두 끝점은 항상 있다.
            val at=saveEpisode(current.edges,episode)
            val wanted=rows.map { RelationEdge(it.id,at,false,requireNotNull(it.sourceCardId),requireNotNull(it.targetCardId),mapper.writeValueAsString(it)) }
            val changes=episodeEdges(relationsAsOf(current.edges,at),wanted,at)
            val checks=params+mapOf("ids" to rows.map { it.id.toString() },"cards" to wanted.flatMap { listOf(it.source,it.target) }.distinct().map { it.toString() })
            // 다른 세계관의 연결이 같은 관계 ID를 쓰거나 다른 세계관이 가진 카드면 그래프에 아무것도 쓰지 않았음이 확정되는 거절이다.
            if(tx.run("MATCH ()-[e:RELATED]->() WHERE e.relationId IN \$ids AND e.worldId <> \$world RETURN count(e) AS n",checks).single()["n"].asLong()!=0L) throw WorldNotFound()
            // MERGE plus a dependent write locks identities before checking ownership, including racing worlds.
            if(tx.run("""UNWIND ${'$'}cards AS id MERGE (n:StudioCard {id:id})
                ON CREATE SET n.worldId=${'$'}world SET n.mutex=coalesce(n.mutex,0)+1
                WITH n WHERE n.worldId <> ${'$'}world RETURN count(n) AS n""",checks).single()["n"].asLong()!=0L) throw WorldNotFound()
            if(changes.isNotEmpty()) {
                // 같은 관계·같은 회차의 옛 연결은 지우고 새로 쓴다(덮어쓰기). 끝점이 바뀌어도 그 회차에는 연결이 하나만 남는다.
                tx.run("MATCH ()-[e:RELATED {worldId: \$world, fromEpisode: \$episode}]->() WHERE e.relationId IN \$ids DELETE e",
                    params+mapOf("episode" to at,"ids" to changes.map { it.relationId.toString() })).consume()
                val edges=changes.map { mapOf("id" to it.relationId.toString(),"source" to it.source.toString(),"target" to it.target.toString(),"ended" to it.ended,"payload" to it.payload) }
                tx.run("""UNWIND ${'$'}rows AS row MATCH (a:StudioCard {id: row.source}),(b:StudioCard {id: row.target})
                    CREATE (a)-[e:RELATED {relationId: row.id, worldId: ${'$'}world, fromEpisode: ${'$'}episode, ended: row.ended}]->(b) SET e.payload=row.payload""",
                    params+mapOf("episode" to at,"rows" to edges)).consume()
            }
            tx.run("""MATCH (w:StudioRelationshipWorld {id: ${'$'}world}) OPTIONAL MATCH ()-[e:RELATED {worldId: ${'$'}world}]->() WITH w,count(e) AS total
                SET w.version=${'$'}version,w.requestKey=${'$'}key,w.requestHash=${'$'}hash,w.count=total""",
                params+mapOf("version" to Math.incrementExact(expected),"key" to key,"hash" to hash)).consume()
            view(worldId,load(tx,worldId),episode)
        },timeout) }
    }

    /** 세계관 노드의 토큰과 이 세계관의 모든 연결이다. 시점 선택은 [view]가 한다. */
    private class Stored(val version:Long,val key:String,val hash:String,val edges:List<RelationEdge>)

    private fun load(tx:TransactionContext,worldId:UUID):Stored {
        val result=tx.run("""MATCH (w:StudioRelationshipWorld {id: ${'$'}world})
            OPTIONAL MATCH (a:StudioCard)-[e:RELATED {worldId: ${'$'}world}]->(b:StudioCard)
            RETURN w.version AS version,w.requestKey AS key,w.requestHash AS hash,w.count AS count,
                collect(CASE WHEN e IS NULL THEN null ELSE {relationId:e.relationId,fromEpisode:e.fromEpisode,ended:e.ended,source:a.id,target:b.id,payload:e.payload} END) AS edges""",
            mapOf("world" to worldId.toString()))
        if(!result.hasNext()) throw WorldStudioFailure.mismatch()
        val row=result.single()
        val edges=try { row["edges"].asList { RelationEdge(UUID.fromString(it["relationId"].asString()),it["fromEpisode"].asInt(),it["ended"].asBoolean(),
            UUID.fromString(it["source"].asString()),UUID.fromString(it["target"].asString()),if(it["payload"].isNull) null else it["payload"].asString()) } }
            catch(_:RuntimeException) { throw WorldStudioFailure.mismatch() }
        if(row["count"].asLong()!=edges.size.toLong()) throw WorldStudioFailure.mismatch()
        return Stored(row["version"].asLong(),row["key"].asString(),row["hash"].asString(),edges)
    }

    private fun view(worldId:UUID,stored:Stored,episode:Int?):RelationshipStateResult {
        val payloads=relationsAsOf(stored.edges,episode).map {
            try { mapper.readValue(requireNotNull(it.payload),RelationshipPayload::class.java) } catch(_:RuntimeException) { throw WorldStudioFailure.mismatch() }
        }
        return RelationshipStateResult(worldId,stored.version,stored.key,stored.hash,payloads.sortedBy { it.id.toString() })
    }

    @Synchronized private fun ensureSchema() {
        if(schemaReady) return
        driver.session(SessionConfig.forDatabase(database)).use { session ->
            for(label in listOf("StudioRelationshipWorld","StudioCard"))
                session.run("CREATE CONSTRAINT ${label.lowercase()}_id IF NOT EXISTS FOR (n:$label) REQUIRE n.id IS UNIQUE").consume()
        }
        schemaReady=true
    }
    private fun <T> access(action:()->T):T=try { action() } catch(_:Neo4jException) { throw WorldStudioFailure.unavailable() }
}
