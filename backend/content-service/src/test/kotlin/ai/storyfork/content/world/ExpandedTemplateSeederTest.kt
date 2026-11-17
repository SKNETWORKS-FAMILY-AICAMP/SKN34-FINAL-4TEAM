package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID
import java.security.MessageDigest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.mockito.ArgumentMatchers
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import org.springframework.core.io.ClassPathResource

class ExpandedTemplateSeederTest {
    @Test fun `default disabled seeder only checks for incomplete markers`() {
        val service=mock(WorldStudioService::class.java)
        ExpandedTemplateSeeder(service,JsonMapper.builder().addModule(KotlinModule.Builder().build()).build(),false).seed()
        verify(service).incompleteExpandedWorldIds()
        verifyNoMoreInteractions(service)
    }
    @Test fun `disabled seeder resumes only worlds with incomplete markers`() {
        val service=mock(WorldStudioService::class.java)
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val manifest=ClassPathResource("sample-worlds-expanded/manifest.json").inputStream.use { mapper.readValue(it,ExpandedManifest::class.java) }
        val pending=manifest.worlds.single { it.genre=="hawaiian_tradition" }
        `when`(service.incompleteExpandedWorldIds()).thenReturn(setOf(pending.worldId))
        ExpandedTemplateSeeder(service,mapper,false).seed()
        val request=ai.storyfork.content.world.service.dto.CreateWorldRequest(pending.name,pending.description,pending.worldId)
        verify(service).startExpanded(eq(request) ?: request,anyString())
        verify(service,never()).startPristineExpanded(anyString(),any(),any(),any(),eq(false))
    }
    @Test fun `cards are written before relations with stable order and optional souls`() {
        val world=ExpandedWorld("fixture",UUID.randomUUID(),"세계","설명",listOf("one.json","two.json"))
        val a=GenreTemplateCard(UUID.randomUUID(),"인물","출처 본문","character","성격")
        val b=GenreTemplateCard(UUID.randomUUID(),"장소","본문","location")
        val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"structural",label="연결")
        val chunks=listOf(ExpandedChunk(listOf(a),listOf(relation)),ExpandedChunk(listOf(b),emptyList()))
        val requests=expandedRequests(world,chunks)
        assertEquals(3,requests.size)
        assertEquals(listOf(0L,1L,2L),requests.map { it.expectedDraftRevision })
        assertEquals(listOf(a.id,b.id),requests.flatMap { it.cards }.map { it.id })
        assertEquals(listOf(relation),requests.flatMap { it.relationships })
        assertEquals("public",requests.first().cards.single().visibility)
        assertEquals("성격",(requests.first().cards.single().semanticMetadata["characterDocs"] as Map<*,*>)["soul"])
        assertEquals(listOf(0,1),requests.flatMap { it.cards }.map { ((it.semanticMetadata["studio"] as Map<*,*>)["templateOrder"] as Int) })
        assertEquals(requests,expandedRequests(world,chunks))
    }
    @Test fun `cross chunk relations cannot point outside the world and duplicate identities are rejected`() {
        val world=ExpandedWorld("fixture",UUID.randomUUID(),"세계","설명",listOf("one.json"))
        val a=GenreTemplateCard(UUID.randomUUID(),"인물","본문","character")
        val bad=RelationshipPayload(UUID.randomUUID(),a.id,UUID.randomUUID(),"structural")
        assertThrows(IllegalArgumentException::class.java) { expandedRequests(world,listOf(ExpandedChunk(listOf(a),listOf(bad)))) }
        assertThrows(IllegalArgumentException::class.java) { expandedRequests(world,listOf(ExpandedChunk(listOf(a,a),emptyList()))) }
    }
    @Test fun `existing worlds with new relationships start only after original verification`() {
        val service=mock(WorldStudioService::class.java)
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val id=UUID.randomUUID();val a=GenreTemplateCard(UUID.randomUUID(),"인물","본문","character","성격")
        val b=GenreTemplateCard(UUID.randomUUID(),"장소","본문","location")
        val world=ExpandedWorld("existing",id,"세계","설명",listOf("one.json"))
        val current=GenreTemplate(world.genre,id,world.name,world.description,listOf(a))
        val baseline=current.copy(cards=listOf(a.copy(soul=null)))
        val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"structural","출처",direction="directed")
        ExpandedTemplateSeeder(service,mapper,true).seedWorld(world,listOf(ExpandedChunk(listOf(a,b),listOf(relation))),null,baseline,current)
        verify(service).startPristineExpanded(anyString(),isNull(),eq(baseline) ?: baseline,eq(current) ?: current,eq(false))
    }
    @Test fun `historical korea frozen create hash remains distinct from expanded input`() {
        // create input at 18a1cf326970b6864a2c9f16fc0819519d46b01e; no historical body is copied.
        val id=UUID.fromString("b08b14fa-dc75-5e3b-8067-148fb6346c72")
        val old=ai.storyfork.content.world.service.dto.CreateWorldRequest("한국 SOURCE 세계: 헐버트 1905의 고대 전승부터 1904년까지",
            "Homer B. Hulbert, The History of Korea (1905) 두 권의 실명·실지명 기반 국가 전체 사료 세계. 고대 전승–삼국–고려–조선–대한제국, 역사적 끝점 1904년 말. 현대 검증·독립 역사 감수 미완료, 원저의 종교·민족·문명론적 편향을 비판적으로 분리한 연구 전용 자료. 독립 검수 미완료인 비공개 연구 기반 샘플이다.",id)
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        fun hash(request:ai.storyfork.content.world.service.dto.CreateWorldRequest)=MessageDigest.getInstance("SHA-256")
            .digest(mapper.writeValueAsBytes(listOf("create",id,request))).joinToString("") { "%02x".format(it) }
        assertEquals("827286925a6651899abb1c2162af7847d3ef2499a17cba03a1ad83a36ae9d171",hash(old))
        assertNotEquals(hash(old),hash(old.copy(name="한국 역사",description="역사 자료에서 추출한 검토 후보.")))
    }
    @Test fun `historical compatibility resource contains only fingerprints`() {
        assertFalse(ClassPathResource("genre-templates-history-original.json").exists())
        val bytes=ClassPathResource("genre-templates-history-fingerprints.json").inputStream.use { it.readBytes() }
        val text=String(bytes, Charsets.UTF_8)
        assertFalse(text.contains("\"body\""));assertFalse(text.contains("\"soul\""))
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val node=mapper.readTree(bytes)
        assertEquals(7,node.size())
        assertEquals(158,node.sumOf { it["cards"].size() })
    }
    @Test fun `seven historical fingerprint resources remain byte stable`() {
        val bytes=ClassPathResource("genre-templates-history-fingerprints.json").inputStream.use { it.readBytes() }
        val sha=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        assertEquals("0c9b3dfa412546d271237c7f7c42e5da5c812bbfa0e7cadd43a8b371ca9a7af1",sha)
    }
    @Test fun `historical create edit and save requests retain original hashes`() {
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val history=ClassPathResource("genre-templates-history-fingerprints.json").inputStream.use { mapper.readValue(it,Array<HistoricalFingerprint>::class.java) }
        val actual=history.joinToString("\n") { listOf(it.genre,it.createHash,it.editHash,it.saveHash).joinToString(" ") }
        val expected="""korea_history 827286925a6651899abb1c2162af7847d3ef2499a17cba03a1ad83a36ae9d171 3a892c8ac96213e5a19d640f0b9507fc6542027f385356f9aaa36d0df4a2fb6d 50e70131b83e6c36e6c2813e499d3b2afac226a3c65ecdf797f9057cc8152818
china_history c133fddbf555be11d55d5a66c88d5e6ee31d13397ee70cdc1682d80c6ca0394c f635dc58ea5829ce21e819d23d03cbb4ee90cdcd68858fb79f4cacc003a8c979 cc67c76a4ac30d31d81474bb118a8b1ce9fe93038f2451c7bf31e330a63330ba
japan_history aceeabdbcf4a0d7bffc8e6aad8e08a342a80e8c546c36b7e9b64540863695289 41e39b87956f05960cccbe4218124aebe78c87d67d39c28f561b5c35f0bd89e1 f6c3b3ec9854f48dbb545678a1e2734dbb95c4ed28a46512212f58b990f530d3
england_history c359d70c19c526cd8f1064a8b700c719e57c1f6583414332c64efb7c8c7813bb 239f783c15b12110c12608a2ff923602c73d8777616961b597f231423ff1fcc1 5a3d02c26b7217044d58544cfa13e7d9127727c53d81f5fce487564918c66fab
france_history 3db120877ce6ee9b0d9cf0e343a9627ce3fef5d388839b0f85967d162cb11fa0 760e4b3946e2b97f04d1e8b68c6f75de9e06e4f858d593d4294361ed6c122142 3dd09f0f9d0a171bb6865057f0aabf06a62004aecdbe7c6f994368525cc1530c
italy_history e59bef7100b62e4bfcda9aa81f41083936181c948ca7dcee811d540bbfeac247 0a8d6ef0cafe7df1a2404988b81ce7cc224c0ea7a44c3ddf04b64b301b997c53 62707e77b4e324a7b8f93ed75d170d34535299ebe43af083bd08bcde89265135
usa_history 96059da0b018e943c9e091552591bae7a7e57fa320fedc79faf6ea38ea09c9ca a93f78fae65bbc5e1a527058f79a544753c0b5569eaf5e48d746117015b9d36f 1040193496b7e73a70de23d7f172d07b2b396077be7a7d6ae2244516080c2892"""
        assertEquals(expected,actual)
    }
    @Test fun `historical input permits candidate cards distinct from the old card IDs`() {
        val service=mock(WorldStudioService::class.java);val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val id=UUID.randomUUID()
        val original=GenreTemplate("korea_history",id,"옛 이름","옛 설명",listOf(GenreTemplateCard(UUID.randomUUID(),"옛 카드","옛 본문","other")))
        val candidate=GenreTemplateCard(UUID.randomUUID(),"후보 카드","후보 본문","other")
        val world=ExpandedWorld("korea_history",id,"새 이름","새 설명",listOf("one.json"))
        ExpandedTemplateSeeder(service,mapper,true).seedHistorical(world,listOf(ExpandedChunk(listOf(candidate),emptyList())),historicalFixture(original,mapper))
        val request=ai.storyfork.content.world.service.dto.CreateWorldRequest(world.name,world.description,id)
        verify(service).startHistoricalExpanded(eq(request) ?: request,anyString(),eq(historicalFixture(original,mapper)) ?: historicalFixture(original,mapper))
    }
    @Test fun `every expanded manifest card and relationship appears once in bounded requests`() {
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val manifest=ClassPathResource("sample-worlds-expanded/manifest.json").inputStream.use { mapper.readValue(it,ExpandedManifest::class.java) }
        assertEquals(36,manifest.worlds.size)
        var cards=0;var relations=0
        manifest.worlds.forEach { world ->
            val chunks=world.chunks.map { name ->
                val bytes=ClassPathResource("sample-worlds-expanded/$name").inputStream.use { it.readBytes() }
                assertTrue(bytes.size<2_000_000,name)
                mapper.readValue(bytes,ExpandedChunk::class.java)
            }
            val requests=expandedRequests(world,chunks,mapper)
            assertEquals(chunks.flatMap { it.cards }.map { it.id },requests.flatMap { it.cards }.map { it.id },world.genre)
            assertEquals(chunks.flatMap { it.relationships },requests.flatMap { it.relationships },world.genre)
            assertTrue(requests.all { it.cards.size<=1000 && it.relationships.size<=1000 && mapper.writeValueAsBytes(it).size<=2_000_000 },world.genre)
            cards+=chunks.sumOf { it.cards.size };relations+=chunks.sumOf { it.relationships.size }
        }
        assertEquals(16461,cards);assertEquals(4216,relations)
    }
    @Test fun `large card chunks split by serialized request size`() {
        val world=ExpandedWorld("fixture",UUID.randomUUID(),"세계","설명",listOf("one.json"))
        val cards=(1..500).map { GenreTemplateCard(UUID.randomUUID(),"카드$it","가".repeat(800),"other") }
        val requests=expandedRequests(world,listOf(ExpandedChunk(cards,emptyList())))
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        assertTrue(requests.size>1)
        assertTrue(requests.all { mapper.writeValueAsBytes(it).size<=2_000_000 })
        assertEquals(cards.map { it.id },requests.flatMap { it.cards }.map { it.id })
    }
    @Test fun `interrupted chunk is retried with identical request and saved once`() {
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val service=mock(WorldStudioService::class.java)
        val world=ExpandedWorld("fixture",UUID.randomUUID(),"세계","설명",listOf("one.json","two.json"))
        val chunks=listOf(ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"하나","본문","other")),emptyList()),
            ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"둘","본문","other")),emptyList()))
        var next=0;var failed=false;val seen=mutableListOf<Triple<String,Int,ai.storyfork.content.world.service.dto.EditWorldDraftRequest>>()
        `when`(service.startExpanded(ArgumentMatchers.any() ?: ai.storyfork.content.world.service.dto.CreateWorldRequest(""),ArgumentMatchers.anyString())).thenAnswer { next }
        doAnswer { call ->
            val index=call.getArgument<Int>(2);seen+=Triple(call.getArgument(1),index,call.getArgument(3))
            if(index==1 && !failed) { failed=true;throw IllegalStateException("중단") }
            next=index+1
            ai.storyfork.content.world.service.dto.WorldDraftResponse(world.worldId,next.toLong(),null,null,world.name,world.description,emptyList(),emptyList())
        }.`when`(service).editExpanded(ArgumentMatchers.any(UUID::class.java) ?: UUID(0,0),ArgumentMatchers.anyString(),ArgumentMatchers.anyInt(),
            ArgumentMatchers.any() ?: ai.storyfork.content.world.service.dto.EditWorldDraftRequest(0,"",""))
        val seeder=ExpandedTemplateSeeder(service,mapper,true)
        assertThrows(IllegalStateException::class.java) { seeder.seedWorld(world,chunks) }
        seeder.seedWorld(world,chunks)
        assertEquals(listOf(0,1,1),seen.map { it.second })
        assertEquals(seen[1],seen[2])
        val expectedSave=ai.storyfork.content.world.service.dto.SaveWorldRequest(2,"expanded-${world.worldId}-save")
        verify(service,times(1)).saveExpanded(ArgumentMatchers.eq(world.worldId) ?: world.worldId,ArgumentMatchers.anyString(),ArgumentMatchers.eq(2),
            ArgumentMatchers.eq(expectedSave) ?: expectedSave)
    }
}
