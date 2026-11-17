package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.time.Duration
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.*
import org.mockito.Mockito.*
import org.springframework.boot.SpringApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory

class SeederStartupOrderIntegrationTest {
    @Test fun `ready event seeds all 26 original worlds before their expansion is attempted`() {
        val service=mock(WorldStudioService::class.java)
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val original=GenreTemplateSeeder(service,mapper)
        val expanded=ExpandedTemplateSeeder(service,mapper,true)
        val expected=original.loadV2().map { it.worldId }.toSet()
        assertEquals(26,expected.size)
        val created=mutableSetOf<UUID>();val attempted=mutableMapOf<UUID,Boolean>()
        doAnswer { call ->
            val request=call.getArgument<CreateWorldRequest>(0);created+=request.id
            WorldDraftResponse(request.id,0,null,null,request.name,request.description,emptyList(),emptyList())
        }.`when`(service).createTemplate(any() ?: CreateWorldRequest(""))
        doAnswer { call ->
            val id=call.getArgument<UUID>(0);val request=call.getArgument<EditWorldDraftRequest>(2)
            WorldDraftResponse(id,request.expectedDraftRevision+1,null,null,request.name,request.description,emptyList(),emptyList())
        }.`when`(service).edit(any(UUID::class.java) ?: UUID(0,0),any(UUID::class.java) ?: UUID(0,0),any() ?: EditWorldDraftRequest(0,"",""))
        doAnswer { call -> WorldDraftResponse(call.getArgument(0),99,UUID.randomUUID(),null,"변경된 초안","",emptyList(),emptyList()) }
            .`when`(service).draft(any(UUID::class.java) ?: UUID(0,0),any(UUID::class.java) ?: UUID(0,0),isNull())
        doAnswer { call -> val template=call.getArgument<GenreTemplate>(3);attempted[template.worldId]=template.worldId in created;null }
            .`when`(service).startPristineExpanded(anyString(),any(),any(),any(),eq(false))
        AnnotationConfigApplicationContext().use { ctx ->
            // Register expanded first to expose any reliance on registration order.
            ctx.beanFactory.registerSingleton("expanded",expanded)
            ctx.beanFactory.registerSingleton("original",original)
            ctx.refresh()
            ctx.publishEvent(ApplicationReadyEvent(SpringApplication(),emptyArray(),ctx,Duration.ZERO))
        }
        assertEquals(expected,attempted.keys)
        assertTrue(attempted.values.all { it },"모든 기존 세계관이 확장 판정 전에 생성돼야 합니다")
    }

    @Test fun `failed original seed is logged and held then retried on the next ready event`() {
        val service=mock(WorldStudioService::class.java)
        val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val original=spy(GenreTemplateSeeder(service,mapper));val expanded=ExpandedTemplateSeeder(service,mapper,true)
        val initial=original.loadLegacy().first();val frozen=original.loadV2().single { it.worldId==initial.worldId }
        val current=original.load().single { it.worldId==initial.worldId }
        doReturn(listOf(initial)).`when`(original).loadLegacy()
        doReturn(listOf(frozen)).`when`(original).loadV2()
        doReturn(listOf(current)).`when`(original).load()
        var attempts=0
        doAnswer { if(++attempts==1) throw IllegalStateException("시드 장애")
            WorldDraftResponse(initial.worldId,0,null,null,initial.name,initial.description,emptyList(),emptyList())
        }.`when`(service).createTemplate(eq(CreateWorldRequest(initial.name,initial.description,initial.worldId)) ?: CreateWorldRequest(""))
        doAnswer { call -> val request=call.getArgument<EditWorldDraftRequest>(2)
            WorldDraftResponse(initial.worldId,request.expectedDraftRevision+1,null,null,request.name,request.description,emptyList(),emptyList())
        }.`when`(service).edit(any(UUID::class.java) ?: UUID(0,0),any(UUID::class.java) ?: UUID(0,0),any() ?: EditWorldDraftRequest(0,"",""))
        doReturn(WorldDraftResponse(initial.worldId,99,UUID.randomUUID(),null,"수정된 초안","",emptyList(),emptyList()))
            .`when`(service).draft(any(UUID::class.java) ?: UUID(0,0),any(UUID::class.java) ?: UUID(0,0),isNull())
        var held=0;var retried=0
        doAnswer { call ->
            val template=call.getArgument<GenreTemplate>(3)
            if(template.worldId==initial.worldId) { if(attempts==1) held++ else retried++ }
            if(attempts==1) null else -1
        }.`when`(service).startPristineExpanded(anyString(),any(),any(),any(),eq(false))
        val sourceLog=LoggerFactory.getLogger(GenreTemplateSeeder::class.java) as Logger
        val expandedLog=LoggerFactory.getLogger(ExpandedTemplateSeeder::class.java) as Logger
        val source=ListAppender<ILoggingEvent>().apply { start() };val target=ListAppender<ILoggingEvent>().apply { start() }
        sourceLog.addAppender(source);expandedLog.addAppender(target)
        try {
            AnnotationConfigApplicationContext().use { ctx ->
                ctx.beanFactory.registerSingleton("expanded",expanded);ctx.beanFactory.registerSingleton("original",original);ctx.refresh()
                val event=ApplicationReadyEvent(SpringApplication(),emptyArray(),ctx,Duration.ZERO)
                ctx.publishEvent(event)
                assertEquals(1,held)
                assertTrue(source.list.any { it.formattedMessage.contains("장르 템플릿 적재 실패 genre=${initial.genre}") })
                assertTrue(target.list.any { it.formattedMessage.contains("확장 샘플 보류 world=${initial.worldId}") })
                ctx.publishEvent(event)
                assertEquals(2,attempts);assertEquals(1,retried)
            }
        } finally { sourceLog.detachAppender(source);expandedLog.detachAppender(target);source.stop();target.stop() }
    }
}
