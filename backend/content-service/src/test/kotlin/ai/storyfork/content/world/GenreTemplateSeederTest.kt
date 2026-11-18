package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.GenreTemplate
import ai.storyfork.content.world.service.GenreTemplateRepair
import ai.storyfork.content.world.service.GenreTemplateSeeder
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.*
import ai.storyfork.content.world.service.dto.*
import java.util.Optional
import java.util.UUID
import java.security.MessageDigest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** 시작 시 장르 템플릿 적재: 서비스 대역으로 호출 계약과 장르별 실패 격리를 확인한다. */
class GenreTemplateSeederTest {
    private val service = mock(WorldStudioService::class.java)
    private val seeder = GenreTemplateSeeder(service, JsonMapper.builder().addModule(KotlinModule.Builder().build()).build())
    private val legacy = seeder.loadLegacy()
    private val current = seeder.load()
    private val frozenIds = seeder.loadV2().map { it.worldId }.toSet()
    private val templates = legacy + current.filter { current -> legacy.none { it.worldId == current.worldId } }
    /** Core auth V8 운영 관리자(admin@example.test, operator=true)의 회원 ID. 템플릿 소유자로 임시 할당한 값을 리터럴로 고정한다. */
    private val owner = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")

    @Test fun `new sample is public at creation even if graph creation fails`() {
        val worlds = mock(StudioWorldRepository::class.java)
        val graph = mock(Neo4jRelationshipRepository::class.java)
        val manager = mock(PlatformTransactionManager::class.java)
        `when`(manager.getTransaction(org.mockito.ArgumentMatchers.any())).thenReturn(SimpleTransactionStatus())
        val real = WorldStudioService(worlds, mock(WorldDraftRepository::class.java), mock(SettingCardRepository::class.java),
            mock(SettingCardDraftRepository::class.java), mock(SettingCardVersionRepository::class.java), mock(WorldRevisionRepository::class.java),
            mock(WorldRevisionCardRepository::class.java), mock(WorldSaveRequestRepository::class.java), mock(WorldRelationshipStateRepository::class.java),
            mock(TemplatePublicationOnceRepository::class.java), mock(ExpandedSeedProgressRepository::class.java), mock(InitialWorldApplicationRepository::class.java), mock(SettingCardImageRepository::class.java), graph, manager,
            JsonMapper.builder().addModule(KotlinModule.Builder().build()).build())
        val single = spy(GenreTemplateSeeder(real, JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()))
        val sample = legacy.first()
        doReturn(listOf(sample)).`when`(single).loadLegacy()
        doReturn(emptyList<GenreTemplate>()).`when`(single).loadV2()
        doReturn(emptyList<GenreTemplate>()).`when`(single).load()
        `when`(worlds.findById(sample.worldId)).thenReturn(Optional.empty())
        doThrow(WorldStudioFailure.unavailable()).`when`(graph).replace(org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0, 0), org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList(), org.mockito.ArgumentMatchers.any<Int>())
        var created: StudioWorld? = null
        `when`(worlds.saveAndFlush(org.mockito.ArgumentMatchers.any(StudioWorld::class.java) ?: StudioWorld(ownerSubject = owner))).thenAnswer { (it.arguments[0] as StudioWorld).also { w -> created = w } }
        single.seed()
        assertEquals("public", created!!.visibility)
        assertNotNull(created!!.publishedAt)
    }

    private fun create(t: GenreTemplate) = CreateWorldRequest(t.name, t.description, t.worldId)
    /** 템플릿 카드는 공개로 넣는다(DEC-46: 카드의 기본은 비공개라, 비공개로 넣으면 템플릿 세계관을 공개해도 카드가 보이지 않는다). */
    private fun edit(t: GenreTemplate) = EditWorldDraftRequest(0, t.name, t.description,
        (if (t in legacy) t.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public") }
        else if (t.worldId in frozenIds) GenreTemplateRepair.payloads(t) else GenreTemplateRepair.soulPayloads(t)), key = "genre-template-${t.genre}")
    private fun save(t: GenreTemplate, revision: Long) = SaveWorldRequest(revision, "genre-template-${t.genre}")
    private fun draft(t: GenreTemplate, revision: Long = 0, saved: UUID? = null) =
        WorldDraftResponse(t.worldId, revision, saved, null, t.name, t.description, emptyList(), emptyList())
    private fun revision(t: GenreTemplate) =
        WorldRevisionResponse(t.worldId, UUID.randomUUID(), 1, t.name, t.description, null, null, emptyList(), null)
    private fun repairEdit(t: GenreTemplate) = EditWorldDraftRequest(2, t.name, t.description,
        GenreTemplateRepair.payloads(t), key = "genre-template-${t.genre}-repair-v2", replace = true)
    private fun savedDraft(t: GenreTemplate, revision: Long, cards: List<CardPayload>): WorldDraftResponse {
        val saved = UUID.randomUUID()
        return WorldDraftResponse(t.worldId, revision, saved, saved, t.name, t.description, cards, emptyList())
    }

    /** 아직 아무것도 적재되지 않은 서비스: create는 새 draft(0), edit는 draft(1)를 돌려준다. */
    private fun fresh(t: GenreTemplate) {
        `when`(service.draft(t.worldId, owner)).thenReturn(draft(t, 5, UUID.randomUUID()))
        `when`(service.createTemplate(create(t))).thenReturn(draft(t))
        `when`(service.edit(t.worldId, owner, edit(t))).thenReturn(draft(t, 1))
        `when`(service.save(t.worldId, owner, save(t, 1))).thenReturn(revision(t))
    }

    @Test fun `every genre is created edited and saved once by the template owner in that order`() {
        assertEquals(11, legacy.size)
        assertEquals(26, templates.size)
        assertEquals(frozenIds, templates.map { it.worldId }.toSet())
        templates.forEach(::fresh)
        seeder.seed()
        val order = inOrder(service)
        templates.filter { it.worldId in frozenIds }.forEach { t ->
            order.verify(service).createTemplate(create(t))
            order.verify(service).edit(t.worldId, owner, edit(t))
            order.verify(service).save(t.worldId, owner, save(t, 1))
            if (t in legacy) order.verify(service).draft(t.worldId, owner)
        }
        templates.filter { it.worldId in frozenIds }.forEach { t -> order.verify(service).draft(t.worldId, owner) }
        templates.filter { it.worldId !in frozenIds }.forEach { t ->
            order.verify(service).createTemplate(create(t))
            order.verify(service).edit(t.worldId, owner, edit(t))
            order.verify(service).save(t.worldId, owner, save(t, 1))
        }
        val frozen=seeder.loadV2()
        templates.forEach { t -> verify(service).publishPristineTemplate(legacy.find { it.worldId==t.worldId },
            frozen.find { it.worldId==t.worldId },current.find { it.worldId==t.worldId }) }
        verifyNoMoreInteractions(service)
    }

    @Test fun `all pristine v1 worlds repair with actual current resources`() {
        templates.forEach(::fresh)
        legacy.forEach { old ->
            val target = current.single { it.worldId == old.worldId }
            assertNotEquals(old.cards, target.cards, old.genre)
            `when`(service.draft(old.worldId, owner)).thenReturn(savedDraft(old, 2, edit(old).cards))
            `when`(service.edit(old.worldId, owner, repairEdit(target))).thenReturn(draft(target, 3))
        }
        seeder.seed()
        legacy.forEach { old ->
            val target = current.single { it.worldId == old.worldId }
            val order = inOrder(service)
            order.verify(service).edit(old.worldId, owner, edit(old))
            order.verify(service).save(old.worldId, owner, save(old, 1))
            order.verify(service).edit(old.worldId, owner, repairEdit(target))
            order.verify(service).save(old.worldId, owner, SaveWorldRequest(3, "genre-template-${old.genre}-repair-v2"))
        }
    }

    @Test fun `changed live resource does not change deployed v2 repair request`() {
        templates.forEach(::fresh)
        val old = legacy.first()
        val baseline = seeder.loadV2().single { it.worldId == old.worldId }
        val modified = baseline.copy(cards = baseline.cards.map { if (it.cardType == "character") it.copy(soul = "새 성격") else it })
        val live = spy(seeder)
        doReturn(current.map { if (it.worldId == old.worldId) modified else it }).`when`(live).load()
        `when`(service.draft(old.worldId, owner)).thenReturn(savedDraft(old, 2, edit(old).cards))
        `when`(service.edit(old.worldId, owner, repairEdit(baseline))).thenReturn(draft(baseline, 3))
        live.seed()
        verify(service).edit(old.worldId, owner, repairEdit(baseline))
        assertEquals(repairEdit(baseline), repairEdit(modified))
        val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val oldBytes = mapper.writeValueAsBytes(listOf("edit", baseline.worldId, repairEdit(baseline)))
        val newBytes = mapper.writeValueAsBytes(listOf("edit", baseline.worldId, repairEdit(modified)))
        assertArrayEquals(oldBytes, newBytes)
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(oldBytes), MessageDigest.getInstance("SHA-256").digest(newBytes))
        verify(service, never()).edit(old.worldId, owner, repairEdit(modified).copy(cards = GenreTemplateRepair.soulPayloads(modified)))
    }

    @Test fun `deployed first and v2 edit request hashes remain stable`() {
        val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val baseline = seeder.loadV2()
        val old = legacy.first()
        val myth = baseline.first { it.worldId !in legacy.map { legacy -> legacy.worldId } }
        fun hash(t: GenreTemplate, request: EditWorldDraftRequest) = MessageDigest.getInstance("SHA-256")
            .digest(mapper.writeValueAsBytes(listOf("edit", t.worldId, request))).joinToString("") { "%02x".format(it) }
        assertEquals(listOf("77cb54ab0ba7f260b3a4a487bf57b78446bd7d909e110603bfb9128246200c72",
            "8760f8302251b20c883672e85ee8ea57e12ccd7c04cd42c20e60d4e532638f31",
            "096162514107e1a48ef7251a7dfc94f4a6fa0d22daeb51617ffc0206f962e0a3"),
            listOf(hash(old, edit(old)), hash(old, repairEdit(baseline.single { it.worldId == old.worldId })), hash(myth, edit(myth))))
    }

    @Test fun `all existing baselines receive soul with distinct keys and unchanged earlier requests`() {
        val frozen = seeder.loadV2()
        val live = frozen.map { t -> t.copy(cards = t.cards.map { c -> if (c.cardType == "character") c.copy(soul = "원전 검토 미확인") else c }) }
        val started = spy(seeder)
        doReturn(live).`when`(started).load()
        val oldById = legacy.associateBy { it.worldId }
        for (t in frozen) {
            val old = oldById[t.worldId]
            val initial = old ?: t
            `when`(service.createTemplate(create(initial))).thenReturn(draft(initial, 2, UUID.randomUUID()))
            val baseCards = GenreTemplateRepair.payloads(t)
            val removed = old?.cards.orEmpty().filter { c -> baseCards.none { it.id == c.id } }.map {
                CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public", lifecycle = "removed")
            }
            val rev = if (old == null) 2L else 4L
            val draft = savedDraft(t, rev, baseCards + removed).copy(relationshipVersion = if (old == null) 1 else 2)
            `when`(service.draft(t.worldId, owner)).thenReturn(draft)
            val parent = old?.let { UUID.randomUUID() }
            val oldIds = old?.cards.orEmpty().map { it.id }.toSet()
            val savedCards = (baseCards + removed).map { SavedCardResponse(UUID.randomUUID(), if (it.id in oldIds) 2 else 1, null, it) }
            `when`(service.revision(t.worldId, owner, draft.currentRevisionId!!)).thenReturn(
                WorldRevisionResponse(t.worldId, draft.currentRevisionId, if (old == null) 1 else 2, t.name, t.description, parent, null, savedCards, null))
            if (old != null) {
                val legacyCards = old.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public") }
                `when`(service.revision(t.worldId, owner, parent!!)).thenReturn(
                    WorldRevisionResponse(t.worldId, parent, 1, old.name, old.description, null, null,
                        legacyCards.map { SavedCardResponse(UUID.randomUUID(), 1, null, it) }, null))
            }
            val target = live.single { it.worldId == t.worldId }
            val request = EditWorldDraftRequest(rev, t.name, t.description, GenreTemplateRepair.soulPayloads(target), key = "genre-template-${t.genre}-soul-v1", replace = true)
            `when`(service.edit(t.worldId, owner, request)).thenReturn(draft(t, rev + 1))
        }
        started.seed()
        for (t in frozen) {
            val rev = if (t.worldId in oldById) 4L else 2L
            val target = live.single { it.worldId == t.worldId }
            val request = EditWorldDraftRequest(rev, t.name, t.description, GenreTemplateRepair.soulPayloads(target), key = "genre-template-${t.genre}-soul-v1", replace = true)
            verify(service).edit(t.worldId, owner, request)
            verify(service).save(t.worldId, owner, SaveWorldRequest(rev + 1, request.key))
        }
    }

    @Test fun `actual resources skip user edits and completed repairs and reject pending conflicts`() {
        templates.forEach(::fresh)
        val (user, completed, pending) = legacy.take(3)
        for (old in listOf(user, completed, pending)) {
            `when`(service.createTemplate(create(old))).thenReturn(draft(old, 2, UUID.randomUUID()))
        }
        val userCards = edit(user).cards.mapIndexed { i, card -> if (i == 0) card.copy(body = "사용자 변경") else card }
        `when`(service.draft(user.worldId, owner)).thenReturn(savedDraft(user, 2, userCards))
        val doneTarget = current.single { it.worldId == completed.worldId }
        `when`(service.draft(completed.worldId, owner)).thenReturn(savedDraft(completed, 4, GenreTemplateRepair.payloads(doneTarget)))
        val pendingTarget = current.single { it.worldId == pending.worldId }
        `when`(service.draft(pending.worldId, owner)).thenThrow(WorldStudioFailure.incomplete())
        `when`(service.edit(pending.worldId, owner, repairEdit(pendingTarget))).thenThrow(IllegalStateException("hash conflict"))
        assertDoesNotThrow { seeder.seed() }
        verify(service, never()).edit(user.worldId, owner, repairEdit(current.single { it.worldId == user.worldId }))
        verify(service, never()).edit(completed.worldId, owner, repairEdit(doneTarget))
        verify(service).edit(pending.worldId, owner, repairEdit(pendingTarget))
        verify(service, never()).save(pending.worldId, owner, SaveWorldRequest(3, "genre-template-${pending.genre}-repair-v2"))
    }

    @Test fun `a failing genre is logged and never stops the others or escapes`() {
        templates.forEach(::fresh)
        val down = templates[0]
        val rejected = templates[4]
        doThrow(WorldStudioFailure.unavailable()).`when`(service).createTemplate(create(down))
        doThrow(IllegalArgumentException("카드 오류")).`when`(service).edit(rejected.worldId, owner, edit(rejected))
        assertDoesNotThrow { seeder.seed() }
        verify(service, never()).edit(down.worldId, owner, edit(down))
        verify(service, never()).save(rejected.worldId, owner, save(rejected, 1))
        (templates - down - rejected).forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
    }

    @Test fun `a resource that cannot be read is logged and never escapes so the server still starts`() {
        val broken = spy(seeder) // @Component는 allopen이라 load()를 그대로 가로챌 수 있다
        doThrow(IllegalStateException("깨진 JSON")).`when`(broken).loadLegacy()
        assertDoesNotThrow { broken.seed() }
        verifyNoInteractions(service)
    }

    @Test fun `an already saved world is not edited again`() {
        templates.forEach(::fresh)
        val done = templates[1]
        `when`(service.createTemplate(create(done))).thenReturn(draft(done, 2, UUID.randomUUID()))
        seeder.seed()
        verify(service, never()).edit(done.worldId, owner, edit(done))
        verify(service, never()).save(done.worldId, owner, save(done, 1))
        (templates - done).forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
    }

    @Test fun `restarts leave a saved sample private after its owner unpublishes it`() {
        templates.forEach(::fresh)
        val done = templates.first()
        `when`(service.createTemplate(create(done))).thenReturn(draft(done, 2, UUID.randomUUID()).copy(visibility = "private"))
        repeat(2) { seeder.seed() }
        verify(service, times(2)).createTemplate(create(done))
        verify(service, never()).publication(org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0, 0),
            org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0, 0), org.mockito.ArgumentMatchers.any(PublicationRequest::class.java) ?: PublicationRequest())
        verify(service, never()).edit(done.worldId, owner, edit(done))
    }

    @Test fun `unreadable repair resource does not block legacy seeding`() {
        templates.forEach(::fresh)
        val broken = spy(seeder)
        doThrow(IllegalStateException("보완 JSON 오류")).`when`(broken).load()
        assertDoesNotThrow { broken.seed() }
        legacy.forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
    }

    @Test fun `missing frozen baseline never uses live resource for old keys`() {
        templates.forEach(::fresh)
        val broken = spy(seeder)
        doThrow(IllegalStateException("스냅샷 오류")).`when`(broken).loadV2()
        broken.seed()
        legacy.forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
        (templates - legacy).forEach { verify(service, never()).createTemplate(create(it)) }
    }

    @Test fun `unreadable frozen resources defer publication and retry after recovery`() {
        templates.forEach(::fresh)
        val broken=spy(seeder)
        doThrow(IllegalStateException("snapshot offline")).doReturn(seeder.loadV2()).`when`(broken).loadV2()
        broken.seed()
        verify(service, never()).publishPristineTemplate(any(), any(), any())
        legacy.forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
        broken.seed()
        verify(service, atLeastOnce()).publishPristineTemplate(any(), any(), any())
    }
    @Test fun `unreadable current resources defer publication and retry after recovery`() {
        templates.forEach(::fresh)
        val broken=spy(seeder)
        doThrow(IllegalStateException("current offline")).doReturn(current).`when`(broken).load()
        broken.seed()
        verify(service, never()).publishPristineTemplate(any(), any(), any())
        legacy.forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
        broken.seed()
        verify(service, atLeastOnce()).publishPristineTemplate(any(), any(), any())
    }
    @Test fun `missing matching frozen resource defers that sample publication`() {
        templates.forEach(::fresh)
        val missing=legacy.first();val broken=spy(seeder)
        doReturn(seeder.loadV2().filter { it.worldId!=missing.worldId }).`when`(broken).loadV2()
        broken.seed()
        verify(service,never()).publishPristineTemplate(eq(missing), isNull(), eq(current.single { it.worldId==missing.worldId }))
        verify(service).save(missing.worldId,owner,save(missing,1))
    }
    @Test fun `restart after edit but before save re-sends the same edit and saves the draft it returns`() {
        templates.forEach(::fresh)
        val half = templates[2]
        `when`(service.createTemplate(create(half))).thenReturn(draft(half, 1))
        seeder.seed()
        verify(service).edit(half.worldId, owner, edit(half))
        verify(service).save(half.worldId, owner, save(half, 1))
    }

    @Test fun `a world whose earlier edit is still pending resumes from edit instead of being stuck`() {
        templates.forEach(::fresh)
        val pending = templates[3]
        doThrow(WorldStudioFailure.incomplete()).`when`(service).createTemplate(create(pending))
        seeder.seed()
        verify(service).edit(pending.worldId, owner, edit(pending))
        verify(service).save(pending.worldId, owner, save(pending, 1))
    }

    @Test fun `runs as a component once the application is ready`() {
        assertTrue(GenreTemplateSeeder::class.java.isAnnotationPresent(Component::class.java))
        val listener = AnnotatedElementUtils.findMergedAnnotation(GenreTemplateSeeder::class.java.getMethod("seed"), EventListener::class.java)
        assertEquals(listOf(ApplicationReadyEvent::class), listener!!.classes.toList()) // Kotlin은 애노테이션의 Class 속성을 KClass로 보여 준다
    }
}
