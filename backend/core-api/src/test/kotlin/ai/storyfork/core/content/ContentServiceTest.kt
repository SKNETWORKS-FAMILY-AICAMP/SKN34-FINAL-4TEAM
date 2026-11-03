package ai.storyfork.core.content

import ai.storyfork.core.content.domain.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ContentServiceTest {
    @Test fun `accepting proposals cannot bypass image validation or mutate the existing draft`() {
        for (text in listOf("data:image/png;base64,eA==", "[[image:${contentId()}]]")) {
            val work = ContentWork(ownerId="author", title="소설", draft=Draft(body="보존할 원고"))
            val proposal = Proposal(text=text, model="test", revision=0, prompt="", baseBody=work.draft.body,
                context=buildContext(work, emptyList(), 1, "", ""))
            work.proposals.add(proposal)
            val repository = org.mockito.Mockito.mock(ai.storyfork.core.content.repository.ContentRepository::class.java)
            org.mockito.Mockito.`when`(repository.find(work.id)).thenReturn(work)
            org.mockito.Mockito.doAnswer { (it.arguments[0] as Function0<*>).invoke() }
                .`when`(repository).transaction(org.mockito.ArgumentMatchers.any<() -> Any>() ?: { work })
            val service = ai.storyfork.core.content.service.ContentService(repository,
                org.mockito.Mockito.mock(ai.storyfork.core.content.client.GenerationClient::class.java),
                tools.jackson.databind.json.JsonMapper.builder().build())
            assertThrows(ContentFailure::class.java) { service.accept(work.id, proposal.id, "author", 0) }
            assertEquals("보존할 원고", work.draft.body)
            assertEquals("pending", proposal.status)
            assertTrue(work.versions.isEmpty())
        }
    }
    @Test fun `settings are private and episode scoped`() {
        val history = listOf(Setting(id="a", versionId="v1", name="secret", content="private"), Setting(id="b", versionId="v2", name="future", content="future", visibility="public", fromEpisode=4))
        assertEquals(1, selectSettings(history, 3).size)
        assertTrue(selectSettings(history, 3, public=true).isEmpty())
        assertTrue(selectSettings(history, 3, character="other").isEmpty())
    }
    @Test fun `private correction must not resurrect earlier public version`() {
        val first = Setting(id="a", versionId="v1", name="rule", content="old", visibility="public")
        assertTrue(selectSettings(listOf(first,first.copy(versionId="v2",visibility="private")),1,true).isEmpty())
    }
    @Test fun `three long chapters keep source and bounded excerpts`() {
        val text = "에리히와 한트베커의 기록이다.\n".repeat(1300)
        val work = ContentWork(title="소설", ownerId="author", episodes=(1..3).map { Episode(it,1,"v$it","회차",text) }.toMutableList())
        val context = buildContext(work, emptyList(), 3, "에리히")
        assertEquals(3,context.episodes.size)
        assertTrue(context.selection.omittedCharacters > 0)
        context.episodes.forEach { e -> e.excerpts.forEach { assertEquals(text.substring(it.start,it.end),it.text) } }
        assertEquals(text,work.episodes[0].body)
        assertTrue(buildContext(work,emptyList(),3,character="독자").episodes.isEmpty())
    }
}
