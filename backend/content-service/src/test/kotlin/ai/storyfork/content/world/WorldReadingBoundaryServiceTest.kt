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

    @Test fun `a restricted episode does not expose wiki detail either`() {
        `when`(access.published("w")).thenReturn(work)
        `when`(currentEpisodes.findByWorkIdAndSequence("w",1)).thenReturn(ai.storyfork.content.episode.entity.EpisodeCurrentEntity(id="e",workId="w",sequence=1,publishedVersionId="v",restricted=true))
        assertEquals(404,assertThrows(ContentFailure::class.java) {service.publicRead("w",1)}.status)
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

    @Test fun `readers of a following Fork whose source was deleted see no source settings`() {
        val forkWork=work.copy(id="f",source=SourceResponse("w","작품",1,1,"분기",deleted=true))
        `when`(access.published("f")).thenReturn(forkWork)
        `when`(access.get("w")).thenReturn(work.copy(deleted=true))
        `when`(forks.findById("f")).thenReturn(Optional.of(ForkEntity(workId="f",sourceWorkId="w",sourceCheckpointId="cp")))
        `when`(references.findById("f")).thenReturn(Optional.of(ForkWorldReferenceEntity(forkWorkId="f",sourceWorldId="w",referenceStatus="following")))
        history()
        `when`(currentEpisodes.findByWorkIdAndSequence("f",1)).thenReturn(ai.storyfork.content.episode.entity.EpisodeCurrentEntity(id="e",workId="f",sequence=1,publishedVersionId="v"))

        assertEquals(emptyList<Any>(),service.publicRead("f",1).documents)
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

    private fun followingFork(basis: Int = 1) {
        val forkWork=work.copy(id="f",source=SourceResponse("w","작품",basis,1,"분기"))
        `when`(access.own("f","owner")).thenReturn(forkWork)
        `when`(access.get("w")).thenReturn(work)
        `when`(forks.findById("f")).thenReturn(Optional.of(ForkEntity(workId="f",sourceWorkId="w",sourceCheckpointId="cp")))
        `when`(references.findById("f")).thenReturn(Optional.of(ForkWorldReferenceEntity(forkWorkId="f",sourceWorldId="w",referenceStatus="following")))
    }

    @Test fun `a following Fork's copy source is the settings its original made public with the wiki details readers see at the basis episode`() {
        followingFork()
        history()
        val detail=SettingReadingDetailEntity(settingVersionId=version.id,aliases=mutableListOf("별칭"),participants=mutableListOf("하린"),
            properties=mutableListOf(ReadingProperty(0,"나이","20",1),ReadingProperty(0,"성별","남",null),ReadingProperty(2,"상태","화남",2)))
        `when`(readingDetails.findAllById(listOf(version.id))).thenReturn(listOf(detail))

        val (setting,wiki)=service.followingSettings("f","owner").single()

        assertEquals(listOf<Any>("s","인물","원문","인물","public",1),listOf(setting.id,setting.name,setting.content,setting.category,setting.visibility,setting.fromEpisode))
        // 독자가 기준 회차(1화)에 보는 규칙 그대로다: 공개 회차가 없는 속성(성별)과 기준 회차 뒤의 속성(상태)은 싣지 않는다.
        assertEquals(listOf("별칭"),wiki.aliases)
        assertEquals(listOf(ReadingPropertyResponse("나이","20")),wiki.properties)
        assertEquals(listOf("하린"),wiki.participants)
    }

    @Test fun `settings the original made private are not copy sources`() {
        followingFork()
        history()
        `when`(visibility.findAllById(listOf("visibility"))).thenReturn(listOf(SettingVisibilityHistoryEntity(id="visibility",settingDocumentId=doc.id,defaultVisibility="private")))

        assertEquals(emptyList<Any>(),service.followingSettings("f","owner"))
    }

    @Test fun `a work that follows no original has no copy source and reads no wiki detail`() {
        `when`(access.own("w","owner")).thenReturn(work)
        history()

        assertEquals(emptyList<Any>(),service.followingSettings("w","owner"))
        verifyNoInteractions(readingDetails)
    }

    @Test fun `only the latest version of a setting can be a copy source, so one the original later made private is not copied even if an older version was public`() {
        followingFork(4)
        // v1은 1~2화에 공개했고 v2는 3화부터 비공개다: 따라가는 이력에는 v1과 '공개 범위에서 제외'로 바뀐 v2가 남고, 설정집은 이 설정을 보이지 않는다.
        val v1=SettingVersionEntity(id=settingVersionId("w","s","v1"),settingDocumentId=doc.id,contentVersionId="v1",revisionNo=0,name="인물",categoryId="인물",content="공개했던 내용",visibilityHistoryId="open")
        val v2=SettingVersionEntity(id=settingVersionId("w","s","v2"),settingDocumentId=doc.id,contentVersionId="v2",revisionNo=1,name="인물",categoryId="인물",content="비공개로 바꾼 내용",visibilityHistoryId="closed")
        `when`(documents.findAllByWorldId("w")).thenReturn(listOf(doc))
        `when`(versions.findAllBySettingDocumentIdInOrderByRevisionNo(listOf(doc.id))).thenReturn(listOf(v1,v2))
        `when`(documents.findAllById(anyList())).thenReturn(listOf(doc))
        `when`(visibility.findAllById(anyList())).thenReturn(listOf(
            SettingVisibilityHistoryEntity(id="open",settingDocumentId=doc.id,defaultVisibility="public"),SettingVisibilityHistoryEntity(id="closed",settingDocumentId=doc.id,defaultVisibility="private")))
        `when`(ranges.findAllByVisibilityHistoryIdIn(anyCollection())).thenReturn(listOf(
            SettingVisibilityRangeEntity(id="r1",visibilityHistoryId="open",startEpisodeId="e1",endEpisodeId="e2",visibility="public"),
            SettingVisibilityRangeEntity(id="r2",visibilityHistoryId="closed",startEpisodeId="e3",endEpisodeId=null,visibility="private")))
        `when`(episodes.findAllById(anyList())).thenReturn(listOf(1,2,3).map {ai.storyfork.content.episode.entity.EpisodeEntity(id="e$it",workId="w",sequence=it)})

        assertEquals(emptyList<Any>(),service.followingSettings("f","owner"))
    }
}
