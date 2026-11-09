package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.*
import ai.storyfork.content.episode_version.repository.CheckpointSettingRepository
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.entity.*
import ai.storyfork.content.fork.service.dto.SourceResponse
import org.mockito.ArgumentMatchers.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.domain.Setting
import ai.storyfork.content.world.entity.*
import ai.storyfork.content.world.repository.*
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.*
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import java.util.Optional

@ExtendWith(MockitoExtension::class)
class WorldReadingBoundaryServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var worlds: WorldRepository
    @Mock lateinit var workWorlds: WorkWorldHistoryRepository
    @Mock lateinit var documents: SettingDocumentRepository
    @Mock lateinit var versions: SettingVersionRepository
    @Mock lateinit var readingDetails: SettingReadingDetailRepository
    @Mock lateinit var currentEpisodes: EpisodeCurrentRepository
    @Mock lateinit var drafts: SettingDraftRepository
    @Mock lateinit var visibility: SettingVisibilityHistoryRepository
    @Mock lateinit var ranges: SettingVisibilityRangeRepository
    @Mock lateinit var tags: SettingTagRepository
    @Mock lateinit var versionTags: SettingVersionTagRepository
    @Mock lateinit var documentTags: SettingDocumentTagRepository
    @Mock lateinit var knowledge: SettingKnowledgeScopeRepository
    @Mock lateinit var origins: SettingOriginRepository
    @Mock lateinit var episodes: EpisodeRepository
    @Mock lateinit var forks: ForkRepository
    @Mock lateinit var references: ForkWorldReferenceRepository
    @Mock lateinit var sourceSettings: ForkSourceSettingRepository
    @Mock lateinit var checkpointSettings: CheckpointSettingRepository
    @Mock lateinit var changes: ForkSourceChangeRepository
    @Mock lateinit var decisions: ForkChangeDecisionRepository
    @Mock lateinit var em: EntityManager
    @InjectMocks lateinit var service: WorldService

    private val work=WorkAccessResult("w","owner","작품","",0,"w","public",true,true,null)
    private val doc=SettingDocumentEntity(id=settingDocumentId("w","s"),worldId="w",logicalId="s")
    private val version=SettingVersionEntity(id=settingVersionId("w","s","v"),settingDocumentId=doc.id,contentVersionId="v",name="인물",categoryId="인물",content="원문",visibilityHistoryId="visibility")
    private fun history() {
        `when`(documents.findAllByWorldId("w")).thenReturn(listOf(doc))
        `when`(versions.findAllBySettingDocumentIdInOrderByRevisionNo(listOf(doc.id))).thenReturn(listOf(version))
        `when`(documents.findAllById(listOf(doc.id))).thenReturn(listOf(doc))
        `when`(visibility.findAllById(listOf("visibility"))).thenReturn(listOf(SettingVisibilityHistoryEntity(id="visibility",settingDocumentId=doc.id,defaultVisibility="public")))
    }

    @Test fun `private work and unpublished episode do not expose wiki detail`() {
        `when`(access.published("private")).thenThrow(ContentFailure(404,"공개 작품 없음"))
        assertEquals(404,assertThrows(ContentFailure::class.java) {service.publicRead("private",1)}.status)
        verifyNoInteractions(readingDetails)
        `when`(access.published("w")).thenReturn(work)
        assertEquals(404,assertThrows(ContentFailure::class.java) {service.publicRead("w",9)}.status)
        verifyNoInteractions(readingDetails)
    }

    @Test fun `original can draft and confirm a new simple setting without rewriting rich history`() {
        `when`(access.own("w","owner")).thenReturn(work)
        `when`(access.get("w")).thenReturn(work)
        val savedDocs=mutableListOf(doc)
        val savedVersions=mutableListOf(version)
        val savedPolicies=mutableListOf(SettingVisibilityHistoryEntity(id="visibility",settingDocumentId=doc.id,defaultVisibility="public"))
        val savedDrafts=mutableMapOf<String,SettingDraftEntity>()
        val world=WorldEntity(id="w",ownerId="owner",name="설정집")
        `when`(worlds.findById("w")).thenReturn(Optional.of(world))
        `when`(documents.findAllByWorldId("w")).thenAnswer {savedDocs.toList()}
        `when`(documents.findAllById(anyList())).thenAnswer {savedDocs.toList()}
        `when`(documents.existsById(anyString())).thenAnswer {inv -> savedDocs.any {it.id==inv.getArgument<String>(0)}}
        `when`(documents.saveAndFlush(any(SettingDocumentEntity::class.java))).thenAnswer {inv -> inv.getArgument<SettingDocumentEntity>(0).also {savedDocs.add(it)}}
        `when`(versions.findAllBySettingDocumentIdInOrderByRevisionNo(anyList())).thenAnswer {savedVersions.toList()}
        `when`(versions.existsById(anyString())).thenAnswer {inv -> savedVersions.any {it.id==inv.getArgument<String>(0)}}
        `when`(versions.saveAndFlush(any(SettingVersionEntity::class.java))).thenAnswer {inv -> inv.getArgument<SettingVersionEntity>(0).also {savedVersions.add(it)}}
        `when`(visibility.findAllById(anyList())).thenAnswer {savedPolicies.toList()}
        `when`(visibility.saveAndFlush(any(SettingVisibilityHistoryEntity::class.java))).thenAnswer {inv -> inv.getArgument<SettingVisibilityHistoryEntity>(0).also {savedPolicies.add(it)}}
        `when`(drafts.findAllBySettingDocumentIdInOrderByEditOrder(anyCollection())).thenAnswer {savedDrafts.values.toList()}
        `when`(drafts.save(any(SettingDraftEntity::class.java))).thenAnswer {inv -> inv.getArgument<SettingDraftEntity>(0).also {savedDrafts[it.settingDocumentId]=it}}
        doAnswer {inv -> inv.getArgument<Iterable<SettingDraftEntity>>(0).forEach {savedDrafts.remove(it.settingDocumentId)};null}.`when`(drafts).deleteAll(anyIterable())
        `when`(episodes.saveAndFlush(any(ai.storyfork.content.episode.entity.EpisodeEntity::class.java))).thenAnswer {it.getArgument(0)}
        val detail=SettingReadingDetailEntity(settingVersionId=version.id,properties=mutableListOf(ReadingProperty(0,"관계","보존",2)))
        lenient().`when`(readingDetails.findAllById(anyList())).thenAnswer {inv -> if(version.id in inv.getArgument<List<String>>(0)) listOf(detail) else emptyList<SettingReadingDetailEntity>()}
        val before=service.read("w","owner")
        val drafted=service.saveDraft("w","new","owner",SettingRequest(0,Setting(name="새 설정",content="새 본문",category="규칙").toPayload(),before.sourceToken))
        val simple=drafted.drafts.single()
        assertEquals(1,drafted.revision)
        val confirmed=service.commit("w",simple.id,"owner",drafted.revision)
        assertTrue(confirmed.drafts.isEmpty())
        assertEquals("새 본문",confirmed.settings.single {it.id==simple.id}.content)
        assertEquals("원문",version.content)
        assertEquals(listOf(ReadingProperty(0,"관계","보존",2)),detail.properties)
        verify(versions,never()).saveAndFlush(version)
        verifyNoInteractions(readingDetails)
    }

    @Test fun `following Fork cannot detach rich source through a new simple draft`() {
        val forkWork=work.copy(id="f",source=SourceResponse("w","작품",1,1,"분기"))
        `when`(access.own("f","owner")).thenReturn(forkWork)
        `when`(access.get("w")).thenReturn(work)
        `when`(forks.findById("f")).thenReturn(Optional.of(ForkEntity(workId="f",sourceWorkId="w",sourceCheckpointId="cp")))
        `when`(references.findById("f")).thenReturn(Optional.of(ForkWorldReferenceEntity(forkWorkId="f",sourceWorldId="w",referenceStatus="following")))
        history()
        `when`(readingDetails.findAllById(listOf(version.id))).thenReturn(listOf(SettingReadingDetailEntity(settingVersionId=version.id)))
        val before=service.read("f","owner")
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.saveDraft("f","new","owner",SettingRequest(0,Setting(name="새 설정",content="새 본문",category="규칙").toPayload(),before.sourceToken))}.status)
        verifyNoInteractions(drafts)
        verify(worlds,never()).saveAndFlush(any(WorldEntity::class.java))
    }

    @Test fun `rich reading metadata cannot be discarded by legacy setting writes`() {
        `when`(access.own("w","owner")).thenReturn(work)
        history()
        val setting=Setting(id="s",versionId="v",name="인물",content="변경",category="인물")
        `when`(readingDetails.findAllById(listOf(version.id))).thenReturn(listOf(SettingReadingDetailEntity(settingVersionId=version.id)))
        val before=service.read("w","owner")
        val failure=assertThrows(ContentFailure::class.java) {service.saveDraft("w","s","owner",SettingRequest(0,setting.toPayload(),before.sourceToken))}
        assertEquals(409,failure.status)
        assertTrue(failure.message.contains("읽기 전용"))
        verify(drafts,never()).save(org.mockito.ArgumentMatchers.any(SettingDraftEntity::class.java))
        verify(worlds,never()).saveAndFlush(org.mockito.ArgumentMatchers.any(WorldEntity::class.java))
    }
}
