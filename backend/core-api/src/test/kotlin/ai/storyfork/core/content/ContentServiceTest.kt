package ai.storyfork.core.content

import ai.storyfork.core.world.domain.*
import ai.storyfork.core.world.service.WorldService
import ai.storyfork.core.world.service.dto.SettingListResponse
import ai.storyfork.core.work.service.WorkAccessService
import ai.storyfork.core.work.service.dto.WorkAccessResult
import ai.storyfork.core.publication.service.PublicationService
import ai.storyfork.core.publication.service.dto.*
import ai.storyfork.core.context.service.ContextService
import ai.storyfork.core.context.service.dto.ContextRequest
import ai.storyfork.core.episode.repository.*
import org.mockito.Mockito.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import tools.jackson.databind.json.JsonMapper

class ContentServiceTest {
    @Test fun `generated proposals cannot inject inline images or unverified image references`() {
        for (text in listOf("data:image/png;base64,eA==", "[[image:${java.util.UUID.randomUUID()}]]")) {
            assertThrows(ai.storyfork.core._common.exception.ContentFailure::class.java) {
                ai.storyfork.core.proposal.domain.ProposalTextPolicy.validate(text)
            }
        }
        assertDoesNotThrow { ai.storyfork.core.proposal.domain.ProposalTextPolicy.validate("허용된 이어쓰기") }
    }
    @Test fun `settings are private and episode scoped`() {
        val history=listOf(Setting(id="a",versionId="v1",name="secret",content="private"),Setting(id="b",versionId="v2",name="future",content="future",visibility="public",fromEpisode=4))
        assertEquals(1,selectSettings(history,3).size)
        assertTrue(selectSettings(history,3,public=true).isEmpty())
        assertTrue(selectSettings(history,3,character="other").isEmpty())
    }
    @Test fun `private correction must not resurrect earlier public version`() {
        val first=Setting(id="a",versionId="v1",name="rule",content="old",visibility="public")
        assertTrue(selectSettings(listOf(first,first.copy(versionId="v2",visibility="private")),1,true).isEmpty())
    }
    @Test fun `three long chapters keep source and bounded excerpts`() {
        val text="에리히와 한트베커의 기록이다.\n".repeat(1300)
        val access=mock(WorkAccessService::class.java)
        val world=mock(WorldService::class.java)
        val publication=mock(PublicationService::class.java)
        val header=WorkAccessResult("work","author","소설","",0,"world","private",false,false,null)
        `when`(access.own("work","author")).thenReturn(header)
        `when`(world.historyForContext("work")).thenReturn(SettingListResponse(emptyList()))
        val originals=(1..3).map {PublishedEpisodeResponse(it,1,"v$it","회차",text)}
        `when`(publication.publishedEpisodes("work")).thenReturn(PublishedEpisodeListResponse(originals))
        val service=ContextService(access,world,publication,mock(EpisodeRepository::class.java),mock(EpisodeDraftRepository::class.java),JsonMapper.builder().findAndAddModules().build())
        val context=service.read("work","author",ContextRequest(3,"에리히"))
        assertEquals(3,context.episodes.size)
        assertTrue(context.selection.omittedCharacters>0)
        context.episodes.forEach {e -> e.excerpts.forEach {assertEquals(text.substring(it.start,it.end),it.text)}}
        assertEquals(text,originals[0].body)
        assertTrue(service.read("work","author",ContextRequest(3,character="독자")).episodes.isEmpty())
    }
}
