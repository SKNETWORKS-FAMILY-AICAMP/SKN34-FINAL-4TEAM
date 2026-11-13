package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.GenreTemplate
import ai.storyfork.content.world.service.GenreTemplateRepair
import ai.storyfork.content.world.service.GenreTemplateSeeder
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** 시작 시 장르 템플릿 적재: 서비스 대역으로 호출 계약과 장르별 실패 격리를 확인한다. */
class GenreTemplateSeederTest {
    private val service = mock(WorldStudioService::class.java)
    private val seeder = GenreTemplateSeeder(service, JsonMapper.builder().addModule(KotlinModule.Builder().build()).build())
    private val legacy = seeder.loadLegacy()
    private val templates = legacy + seeder.load().filter { current -> legacy.none { it.worldId == current.worldId } }
    /** Core auth V8 운영 관리자(admin@example.test, operator=true)의 회원 ID. 템플릿 소유자로 임시 할당한 값을 리터럴로 고정한다. */
    private val owner = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")

    private fun create(t: GenreTemplate) = CreateWorldRequest(t.name, t.description, t.worldId)
    /** 템플릿 카드는 공개로 넣는다(DEC-46: 카드의 기본은 비공개라, 비공개로 넣으면 템플릿 세계관을 공개해도 카드가 보이지 않는다). */
    private fun edit(t: GenreTemplate) = EditWorldDraftRequest(0, t.name, t.description,
<<<<<<< HEAD
        (if (t in legacy) t.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic") } else GenreTemplateRepair.payloads(t)), key = "genre-template-${t.genre}")
=======
        t.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public") }, key = "genre-template-${t.genre}")
>>>>>>> 243423237fe91204f89d25cab238c64cabe6e285
    private fun save(t: GenreTemplate, revision: Long) = SaveWorldRequest(revision, "genre-template-${t.genre}")
    private fun draft(t: GenreTemplate, revision: Long = 0, saved: UUID? = null) =
        WorldDraftResponse(t.worldId, revision, saved, null, t.name, t.description, emptyList(), emptyList())
    private fun revision(t: GenreTemplate) =
        WorldRevisionResponse(t.worldId, UUID.randomUUID(), 1, t.name, t.description, null, null, emptyList(), null)

    /** 아직 아무것도 적재되지 않은 서비스: create는 새 draft(0), edit는 draft(1)를 돌려준다. */
    private fun fresh(t: GenreTemplate) {
        `when`(service.draft(t.worldId, owner)).thenReturn(draft(t, 5, UUID.randomUUID()))
        `when`(service.create(owner, create(t))).thenReturn(draft(t))
        `when`(service.edit(t.worldId, owner, edit(t))).thenReturn(draft(t, 1))
        `when`(service.save(t.worldId, owner, save(t, 1))).thenReturn(revision(t))
    }

    @Test fun `every genre is created edited and saved once by the template owner in that order`() {
        assertEquals(11, legacy.size)
        assertEquals(25, templates.size)
        templates.forEach(::fresh)
        seeder.seed()
        val order = inOrder(service)
        templates.forEach { t ->
            order.verify(service).create(owner, create(t))
            order.verify(service).edit(t.worldId, owner, edit(t))
            order.verify(service).save(t.worldId, owner, save(t, 1))
            if (t in legacy) order.verify(service).draft(t.worldId, owner)
        }
        verifyNoMoreInteractions(service)
    }

    @Test fun `a failing genre is logged and never stops the others or escapes`() {
        templates.forEach(::fresh)
        val down = templates[0]
        val rejected = templates[4]
        doThrow(WorldStudioFailure.unavailable()).`when`(service).create(owner, create(down))
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
        `when`(service.create(owner, create(done))).thenReturn(draft(done, 2, UUID.randomUUID()))
        seeder.seed()
        verify(service, never()).edit(done.worldId, owner, edit(done))
        verify(service, never()).save(done.worldId, owner, save(done, 1))
        (templates - done).forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
    }

    @Test fun `unreadable repair resource does not block legacy seeding`() {
        templates.forEach(::fresh)
        val broken = spy(seeder)
        doThrow(IllegalStateException("보완 JSON 오류")).`when`(broken).load()
        assertDoesNotThrow { broken.seed() }
        legacy.forEach { verify(service).save(it.worldId, owner, save(it, 1)) }
    }

    @Test fun `restart after edit but before save re-sends the same edit and saves the draft it returns`() {
        templates.forEach(::fresh)
        val half = templates[2]
        `when`(service.create(owner, create(half))).thenReturn(draft(half, 1))
        seeder.seed()
        verify(service).edit(half.worldId, owner, edit(half))
        verify(service).save(half.worldId, owner, save(half, 1))
    }

    @Test fun `a world whose earlier edit is still pending resumes from edit instead of being stuck`() {
        templates.forEach(::fresh)
        val pending = templates[3]
        doThrow(WorldStudioFailure.incomplete()).`when`(service).create(owner, create(pending))
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
