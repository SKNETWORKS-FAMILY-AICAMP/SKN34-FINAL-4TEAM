package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.relationship.Neo4jRelationshipConfig
import ai.storyfork.content.world.service.dto.RelationshipChange
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

/** Neo4j 드라이버는 대역이다. 실제 Cypher는 CI의 WorldStudioServicePostgresTest가 격리 Neo4j에서 확인한다. */
class Neo4jRelationshipRepositoryTest {
    private val driver=mock(Driver::class.java)
    private val session=mock(Session::class.java)
    private val tx=mock(TransactionContext::class.java)
    private val result=mock(Result::class.java)
    private val row=mock(org.neo4j.driver.Record::class.java)
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val repository=Neo4jRelationshipRepository(driver,mapper,"neo4j")
    private val world=UUID.randomUUID()
    private val a=UUID.randomUUID();private val b=UUID.randomUUID();private val c=UUID.randomUUID()

    private fun relation(source:UUID=a,target:UUID=b,body:String="",id:UUID=UUID.randomUUID())=
        RelationshipPayload(id,source,target,"emotional",body,direction="directed",polarity="asserted")
    /** 그래프가 돌려주는 연결 한 개다. 종료 연결은 payload가 없다. */
    private fun edge(r:RelationshipPayload,from:Int,ended:Boolean=false):Map<String,Any?> = mapOf("relationId" to r.id.toString(),"fromEpisode" to from,"ended" to ended,
        "source" to r.sourceCardId.toString(),"target" to r.targetCardId.toString(),"payload" to if(ended) null else mapper.writeValueAsString(r))
    private fun stored(edges:List<Map<String,Any?>>,count:Int=edges.size,version:Int=4,key:String="request",hash:String="hash")=
        mapOf("version" to version,"key" to key,"hash" to hash,"count" to count,"edges" to edges)

    private fun answer(data:Map<String,Any?>) {
        `when`(driver.session(any(SessionConfig::class.java))).thenReturn(session)
        doAnswer { it.getArgument<TransactionCallback<RelationshipStateResult>>(0).execute(tx) }.`when`(session).executeRead<RelationshipStateResult>(any(),any(TransactionConfig::class.java))
        `when`(tx.run(anyString(),anyMap<String,Any>())).thenReturn(result)
        `when`(result.hasNext()).thenReturn(true);`when`(result.single()).thenReturn(row)
        for((key,value) in data) `when`(row[key]).thenReturn(Values.value(value))
    }

    @Test fun `current relationships preserve stable IDs multiple edges body direction and polarity`() {
        val relations=listOf(relation(body="신뢰하면서 경계\n원문"),relation(body="형제").copy(direction="symmetric",polarity="denied"))
        answer(stored(relations.map { edge(it,1) }))
        assertEquals(relations.sortedBy { it.id.toString() },repository.read(world).relationships)
        verify(tx).run(contains("${'$'}world"),eq(mapOf("world" to world.toString())))
        verify(session).close()
    }
    @Test fun `a relation shows its latest connection up to the requested episode and ended ones drop out`() {
        val early=relation(body="초반");val mid=early.copy(body="중반");val other=relation(a,c,"다른 관계")
        answer(stored(listOf(edge(early,1),edge(mid,3),edge(other,2),edge(other,4,ended=true))))
        assertEquals(listOf(early,other).sortedBy { it.id.toString() },repository.read(world,2).relationships)
        assertEquals(listOf(mid,other).sortedBy { it.id.toString() },repository.read(world,3).relationships)
        assertEquals(listOf(mid),repository.read(world,4).relationships)
        assertEquals(listOf(mid),repository.read(world).relationships)
        assertTrue(repository.read(world,0).relationships.isEmpty())
    }
    @Test fun `read tells when each relation started and the changes up to the requested episode`() {
        val early=relation(body="초반").copy(label="경계");val mid=early.copy(label="보호",body="중반");val late=early.copy(label="신뢰",body="후반")
        val steady=relation(a,c,"그대로")
        answer(stored(listOf(edge(early,1),edge(mid,3),edge(late,6),edge(steady,2))))
        val atFour=repository.read(world,4)
        assertEquals(mapOf(early.id to 3,steady.id to 2),atFour.episodes)
        assertEquals(mapOf(early.id to listOf(RelationshipChange(1,"경계","초반"),RelationshipChange(3,"보호","중반"))),atFour.history) // 6화의 변화는 없다
        val latest=repository.read(world)
        assertEquals(listOf(1,3,6),latest.history.getValue(early.id).map { it.episode })
        assertFalse(steady.id in latest.history) // 바뀐 적 없는 관계는 이력이 없다
        assertTrue(repository.read(world,2).history.isEmpty())
    }
    @Test fun `missing or corrupt current graph is an explicit failure not an empty success`() {
        answer(stored(emptyList(),count=1))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { repository.read(world) }.code)
        // 기존 StudioRelationship만 있고 아직 연결로 옮기지 않은 세계관도 같다: 기록된 수와 연결 수가 다르다.
        answer(stored(listOf(edge(relation(),1)),count=3))
        assertThrows(WorldStudioFailure::class.java) { repository.read(world) }
        `when`(result.hasNext()).thenReturn(false)
        assertThrows(WorldStudioFailure::class.java) { repository.read(world) }
    }
    @Test fun `an unreadable payload or two latest connections of one relation are a mismatch`() {
        val duplicated=relation()
        answer(stored(listOf(edge(duplicated,2),edge(duplicated.copy(body="다른"),2))))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { repository.read(world) }.code)
        answer(stored(listOf(edge(duplicated,1).plus("payload" to "{ not json"))))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { repository.read(world) }.code)
    }

    /**
     * 쓰기 트랜잭션 대역이다. 실행한 질의를 순서대로 기록하고, 세계관·연결을 읽는 질의에는 [loads]를 차례로(마지막은 반복) 답한다.
     * [foreignRelations]·[foreignCards]는 다른 세계관이 이미 쓰는 관계·카드 ID 수다.
     */
    private fun scripted(loads:List<Map<String,Any?>>,foreignRelations:Long=0,foreignCards:Long=0):MutableList<Pair<String,Map<String,Any?>>> {
        val log=mutableListOf<Pair<String,Map<String,Any?>>>()
        val loadRow=mock(org.neo4j.driver.Record::class.java)
        for(key in listOf("version","key","hash","count","edges"))
            `when`(loadRow[key]).thenReturn(Values.value(loads.first()[key]),*loads.drop(1).map { Values.value(it[key]) }.toTypedArray())
        fun replying(record:org.neo4j.driver.Record?):Result=mock(Result::class.java).also { `when`(it.hasNext()).thenReturn(true);`when`(it.single()).thenReturn(record) }
        val foreignRelationRow=mock(org.neo4j.driver.Record::class.java).also { `when`(it["n"]).thenReturn(Values.value(foreignRelations)) }
        val foreignCardRow=mock(org.neo4j.driver.Record::class.java).also { `when`(it["n"]).thenReturn(Values.value(foreignCards)) }
        val load=replying(loadRow);val relations=replying(foreignRelationRow);val cards=replying(foreignCardRow);val other=replying(null)
        `when`(driver.session(any(SessionConfig::class.java))).thenReturn(session)
        `when`(session.run(anyString())).thenReturn(other)
        doAnswer { it.getArgument<TransactionCallback<RelationshipStateResult>>(0).execute(tx) }.`when`(session).executeWrite<RelationshipStateResult>(any(),any(TransactionConfig::class.java))
        `when`(tx.run(anyString(),anyMap<String,Any>())).thenAnswer { call ->
            val query=call.getArgument<String>(0)
            @Suppress("UNCHECKED_CAST") val params=call.getArgument<Map<String,Any?>>(1)
            log+=query to params
            when {
                "RETURN w.version" in query -> load
                "RETURN count(e) AS n" in query -> relations
                "RETURN count(n) AS n" in query -> cards
                else -> other
            }
        }
        return log
    }
    /** 연결을 지우거나 쓰는 질의와 세계관 토큰(version)을 올리는 질의다. */
    private fun List<Pair<String,Map<String,Any?>>>.writes()=filter { (query,params) -> "DELETE e" in query || "CREATE (a)-[e:RELATED" in query || "version" in params }
    @Suppress("UNCHECKED_CAST") private fun Map<String,Any?>.rows()=this["rows"] as List<Map<String,Any?>>

    @Test fun `replace writes only the changed relations at the saved episode and ends the ones left out`() {
        val kept=relation(a,b,"유지");val dropped=relation(b,c,"빠짐");val added=relation(a,c,"새 관계")
        val log=scripted(listOf(stored(listOf(edge(kept,1),edge(dropped,1)),key="old",hash="old-hash"),
            stored(listOf(edge(kept,1),edge(added,1),edge(dropped,1,ended=true)),version=5,key="new",hash="new-hash")))
        val saved=repository.replace(world,4,"new","new-hash",listOf(kept,added))
        assertEquals(5L,saved.version);assertEquals("new",saved.key);assertEquals("new-hash",saved.hash)
        assertEquals(listOf(kept,added).sortedBy { it.id.toString() },saved.relationships)
        val delete=log.single { "DELETE e" in it.first };val create=log.single { "CREATE (a)-[e:RELATED" in it.first };val update=log.single { "version" in it.second }
        // 회차를 생략하면 이 세계관의 마지막 연결 회차(1)다. 같은 회차의 옛 연결을 지우고 바뀐 것만 새로 쓴다.
        assertEquals(1,delete.second["episode"]);assertEquals(world.toString(),delete.second["world"])
        assertEquals(setOf(added.id.toString(),dropped.id.toString()),(delete.second["ids"] as List<*>).toSet())
        assertEquals(1,create.second["episode"])
        assertEquals(mapOf(added.id.toString() to Triple(a.toString(),c.toString(),false),dropped.id.toString() to Triple(b.toString(),c.toString(),true)),
            create.second.rows().associate { it["id"] as String to Triple(it["source"],it["target"],it["ended"]) })
        assertEquals(mapper.writeValueAsString(added),create.second.rows().single { it["id"]==added.id.toString() }["payload"])
        assertNull(create.second.rows().single { it["id"]==dropped.id.toString() }["payload"])
        assertEquals(5L,update.second["version"]);assertEquals("new",update.second["key"]);assertEquals("new-hash",update.second["hash"])
        assertTrue(log.indexOf(delete)<log.indexOf(create) && log.indexOf(create)<log.indexOf(update))
        verify(session,times(2)).close()
    }
    @Test fun `replace at an earlier episode compares with that episode and leaves later connections alone`() {
        val early=relation(body="초반");val late=early.copy(body="후반")
        val unchanged=scripted(listOf(stored(listOf(edge(early,1),edge(late,5))),stored(listOf(edge(early,1),edge(late,5)),version=5,key="k",hash="h")))
        repository.replace(world,4,"k","h",listOf(early),3)
        assertEquals(1,unchanged.writes().size);assertTrue("version" in unchanged.writes().single().second)
        val changed=scripted(listOf(stored(listOf(edge(early,1),edge(late,5))),stored(listOf(edge(early,1),edge(early.copy(body="중반"),3),edge(late,5)),version=5,key="k",hash="h")))
        repository.replace(world,4,"k","h",listOf(early.copy(body="중반")),3)
        val delete=changed.single { "DELETE e" in it.first };val create=changed.single { "CREATE (a)-[e:RELATED" in it.first }
        assertEquals(3,delete.second["episode"]);assertEquals(listOf(early.id.toString()),delete.second["ids"])
        assertEquals(3,create.second["episode"]);assertEquals(listOf(early.id.toString()),create.second.rows().map { it["id"] })
    }
    @Test fun `replace writes each changed relation at its own episode and the rest at the saved episode`() {
        val kept=relation(a,b,"유지");val timedOld=relation(b,c,"이전");val timedNew=timedOld.copy(body="이후");val added=relation(a,c,"새 관계")
        val log=scripted(listOf(stored(listOf(edge(kept,1),edge(timedOld,1)),key="old",hash="old-hash"),
            stored(listOf(edge(kept,1),edge(timedOld,1),edge(timedNew,6),edge(added,1)),version=5,key="new",hash="new-hash")))
        repository.replaceWithEpisodes(world,4,"new","new-hash",listOf(kept,timedNew,added),null,mapOf(timedNew.id to 6))
        val deletes=log.filter { "DELETE e" in it.first }.associate { it.second["episode"] to it.second["ids"] }
        val creates=log.filter { "CREATE (a)-[e:RELATED" in it.first }.associate { it.second["episode"] to it.second.rows().map { row -> row["id"] } }
        // 회차를 생략하면 마지막 연결 회차(1)가 기본이라 자기 회차가 없는 새 관계는 1화에, 6화부터를 정한 관계는 6화에 쓴다. 그대로인 관계는 쓰지 않는다.
        assertEquals(mapOf<Any?,Any?>(1 to listOf(added.id.toString()),6 to listOf(timedNew.id.toString())),deletes)
        assertEquals(mapOf<Any?,Any?>(1 to listOf(added.id.toString()),6 to listOf(timedNew.id.toString())),creates)
    }
    @Test fun `the latest view after a save honours per-relation episodes`() {
        val old=relation().copy(body="옛");val later=old.copy(body="뒤");val saved=old.copy(body="새")
        answer(stored(listOf(edge(old,1),edge(later,5))))
        assertEquals(listOf(saved),repository.readAfter(world,listOf(saved)).relationships) // 마지막 연결 회차(5화)에 저장하면 새 값이 최신이다
        assertEquals(listOf(later),repository.readAfterWithEpisodes(world,listOf(saved),null,mapOf(saved.id to 2)).relationships) // 2화부터로 저장하면 5화 연결이 그대로라 최신은 뒤 값이다
    }
    @Test fun `replace without connections yet saves at the first episode`() {
        val first=relation()
        val log=scripted(listOf(stored(emptyList()),stored(listOf(edge(first,1)),version=5,key="k",hash="h")))
        repository.replace(world,4,"k","h",listOf(first))
        assertEquals(1,log.single { "CREATE (a)-[e:RELATED" in it.first }.second["episode"])
        assertEquals(setOf(a.toString(),b.toString()),(log.single { "RETURN count(n) AS n" in it.first }.second["cards"] as List<*>).toSet())
    }
    @Test fun `the exact retry of an applied request returns the stored state without writing again`() {
        val applied=relation()
        val log=scripted(listOf(stored(listOf(edge(applied,1)),version=5,key="k",hash="h")))
        val saved=repository.replace(world,4,"k","h",listOf(applied))
        assertEquals(5L,saved.version);assertEquals(listOf(applied),saved.relationships)
        assertTrue(log.writes().isEmpty());assertTrue(log.none { "RETURN count" in it.first })
    }
    @Test fun `a stale expected version is a mismatch before anything is written`() {
        val log=scripted(listOf(stored(listOf(edge(relation(),1)),version=6)))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { repository.replace(world,4,"k","h",emptyList()) }.code)
        assertTrue(log.writes().isEmpty())
    }
    @Test fun `the first write creates the world node and starts at version zero without any connection`() {
        val log=scripted(listOf(stored(emptyList(),version=-1,key="",hash=""),stored(emptyList(),version=0,key="create",hash="h")))
        val saved=repository.replace(world,-1,"create","h",emptyList())
        assertTrue(log.first().first.startsWith("MERGE (w:StudioRelationshipWorld"))
        assertEquals(0L,saved.version);assertTrue(saved.relationships.isEmpty())
        assertEquals(1,log.writes().size);assertEquals(0L,log.writes().single().second["version"])
    }
    @Test fun `a relation ID another world already uses is rejected inside the graph callback before any write`() {
        val log=scripted(listOf(stored(emptyList())),foreignRelations=1)
        assertThrows(WorldNotFound::class.java) { repository.replace(world,4,"new","hash",listOf(relation())) }
        assertTrue(log.writes().isEmpty())
        verify(session,times(2)).close()
    }
    @Test fun `a card another world already owns is rejected inside the graph callback before any write`() {
        val log=scripted(listOf(stored(emptyList())),foreignCards=1)
        assertThrows(WorldNotFound::class.java) { repository.replace(world,4,"new","hash",listOf(relation())) }
        assertTrue(log.writes().isEmpty())
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
