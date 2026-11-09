package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.GenreTemplate
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
    private val templates = seeder.load()
    /** Core auth V11이 만드는 STORYFORK 플랫폼 계정 ID. 양쪽 테스트가 같은 값을 고정한다. */
    private val platform = UUID.fromString("b09cdf87-6901-50df-9c76-881c81f4f034")

    private fun create(t: GenreTemplate) = CreateWorldRequest(t.name, t.description, t.worldId)
    private fun edit(t: GenreTemplate) = EditWorldDraftRequest(0, t.name, t.description,
        t.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic") }, key = "genre-template-${t.genre}")
    private fun save(t: GenreTemplate, revision: Long) = SaveWorldRequest(revision, "genre-template-${t.genre}")
    private fun draft(t: GenreTemplate, revision: Long = 0, saved: UUID? = null) =
        WorldDraftResponse(t.worldId, revision, saved, null, t.name, t.description, emptyList(), emptyList())
    private fun revision(t: GenreTemplate) =
        WorldRevisionResponse(t.worldId, UUID.randomUUID(), 1, t.name, t.description, null, null, emptyList(), null)

    /** 아직 아무것도 적재되지 않은 서비스: create는 새 draft(0), edit는 draft(1)를 돌려준다. */
    private fun fresh(t: GenreTemplate) {
        `when`(service.create(platform, create(t))).thenReturn(draft(t))
        `when`(service.edit(t.worldId, platform, edit(t))).thenReturn(draft(t, 1))
        `when`(service.save(t.worldId, platform, save(t, 1))).thenReturn(revision(t))
    }

    @Test fun `every genre is created edited and saved once by the platform account in that order`() {
        assertEquals(11, templates.size)
        templates.forEach(::fresh)
        seeder.seed()
        val order = inOrder(service)
        templates.forEach { t ->
            order.verify(service).create(platform, create(t))
            order.verify(service).edit(t.worldId, platform, edit(t))
            order.verify(service).save(t.worldId, platform, save(t, 1))
        }
        verifyNoMoreInteractions(service)
    }

    @Test fun `a failing genre is logged and never stops the others or escapes`() {
        templates.forEach(::fresh)
        val down = templates[0]
        val rejected = templates[4]
        doThrow(WorldStudioFailure.unavailable()).`when`(service).create(platform, create(down))
        doThrow(IllegalArgumentException("카드 오류")).`when`(service).edit(rejected.worldId, platform, edit(rejected))
        assertDoesNotThrow { seeder.seed() }
        verify(service, never()).edit(down.worldId, platform, edit(down))
        verify(service, never()).save(rejected.worldId, platform, save(rejected, 1))
        (templates - down - rejected).forEach { verify(service).save(it.worldId, platform, save(it, 1)) }
    }

    @Test fun `a resource that cannot be read is logged and never escapes so the server still starts`() {
        val broken = spy(seeder) // @Component는 allopen이라 load()를 그대로 가로챌 수 있다
        doThrow(IllegalStateException("깨진 JSON")).`when`(broken).load()
        assertDoesNotThrow { broken.seed() }
        verifyNoInteractions(service)
    }

    @Test fun `an already saved world is not edited again`() {
        templates.forEach(::fresh)
        val done = templates[1]
        `when`(service.create(platform, create(done))).thenReturn(draft(done, 2, UUID.randomUUID()))
        seeder.seed()
        verify(service, never()).edit(done.worldId, platform, edit(done))
        verify(service, never()).save(done.worldId, platform, save(done, 1))
        (templates - done).forEach { verify(service).save(it.worldId, platform, save(it, 1)) }
    }

    @Test fun `restart after edit but before save re-sends the same edit and saves the draft it returns`() {
        templates.forEach(::fresh)
        val half = templates[2]
        `when`(service.create(platform, create(half))).thenReturn(draft(half, 1))
        seeder.seed()
        verify(service).edit(half.worldId, platform, edit(half))
        verify(service).save(half.worldId, platform, save(half, 1))
    }

    @Test fun `a world whose earlier edit is still pending resumes from edit instead of being stuck`() {
        templates.forEach(::fresh)
        val pending = templates[3]
        doThrow(WorldStudioFailure.incomplete()).`when`(service).create(platform, create(pending))
        seeder.seed()
        verify(service).edit(pending.worldId, platform, edit(pending))
        verify(service).save(pending.worldId, platform, save(pending, 1))
    }

    @Test fun `runs as a component once the application is ready`() {
        assertTrue(GenreTemplateSeeder::class.java.isAnnotationPresent(Component::class.java))
        val listener = AnnotatedElementUtils.findMergedAnnotation(GenreTemplateSeeder::class.java.getMethod("seed"), EventListener::class.java)
        assertEquals(listOf(ApplicationReadyEvent::class), listener!!.classes.toList()) // Kotlin은 애노테이션의 Class 속성을 KClass로 보여 준다
    }
}
