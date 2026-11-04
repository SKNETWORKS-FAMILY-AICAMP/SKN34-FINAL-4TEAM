package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource
import org.springframework.transaction.interceptor.TransactionInterceptor
import org.springframework.aop.framework.ProxyFactory

class WorldStudioServiceTest {
    private val worlds=mock(StudioWorldRepository::class.java)
    private val drafts=mock(WorldDraftRepository::class.java)
    private val cards=mock(SettingCardRepository::class.java)
    private val cardDrafts=mock(SettingCardDraftRepository::class.java)
    private val cardVersions=mock(SettingCardVersionRepository::class.java)
    private val relationships=mock(RelationshipRepository::class.java)
    private val relationDrafts=mock(RelationshipDraftRepository::class.java)
    private val relationVersions=mock(RelationshipVersionRepository::class.java)
    private val revisions=mock(WorldRevisionRepository::class.java)
    private val revisionCards=mock(WorldRevisionCardRepository::class.java)
    private val revisionRelations=mock(WorldRevisionRelationshipRepository::class.java)
    private val requests=mock(WorldSaveRequestRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenReturn(SimpleTransactionStatus())
    }
    private val service=WorldStudioService(worlds,drafts,cards,cardDrafts,cardVersions,relationships,relationDrafts,relationVersions,revisions,revisionCards,revisionRelations,requests)

    @Test fun `public operations use default writable transactions including locked reads`() {
        val source=AnnotationTransactionAttributeSource()
        val operations=WorldStudioService::class.java.declaredMethods.filter { java.lang.reflect.Modifier.isPublic(it.modifiers) }
        assertEquals(setOf("create","draft","revision","edit","save","restore"),operations.map { it.name }.toSet())
        operations.forEach {
            val attribute=source.getTransactionAttribute(it,WorldStudioService::class.java)!!
            assertFalse(attribute.isReadOnly)
            assertEquals("worldStudioTransactionManager",attribute.qualifier)
        }
        val proxy=ProxyFactory(service).apply {
            isProxyTargetClass=true
            addAdvice(TransactionInterceptor(manager,source).apply {
                setBeanFactory(org.springframework.beans.factory.support.DefaultListableBeanFactory().apply {
                    registerSingleton("worldStudioTransactionManager",manager)
                })
            })
        }.proxy as WorldStudioService
        assertThrows(WorldNotFound::class.java) { proxy.draft(UUID.randomUUID(),UUID.randomUUID()) }
        verify(manager).rollback(any())
        verify(manager,never()).commit(any())
    }

    @Test fun `unowned world fails before reading drafts or history`() {
        val world=UUID.randomUUID();val actor=UUID.randomUUID()
        assertThrows(WorldNotFound::class.java) { service.save(world,actor,SaveWorldRequest(0,"request")) }
        verifyNoInteractions(drafts,cards,cardDrafts,cardVersions,relationships,relationDrafts,relationVersions,revisions,revisionCards,revisionRelations,requests)
    }
    @Test fun `stale revision fails before writing versions and preserves draft`() {
        val world=UUID.randomUUID();val actor=UUID.randomUUID()
        `when`(worlds.lockOwned(world,actor)).thenReturn(StudioWorld(world,actor))
        val original=WorldDraft(worldId=world,name="기존 편집본",draftRevision=2)
        `when`(drafts.findById(world)).thenReturn(Optional.of(original))
        assertThrows(WorldConflict::class.java) { service.save(world,actor,SaveWorldRequest(1,"request")) }
        assertEquals("기존 편집본",original.name);assertEquals(2L,original.draftRevision)
        verifyNoInteractions(cardVersions,relationVersions,revisions,revisionCards,revisionRelations)
    }
}
