package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.client.WorkTagSuggestionCallFailure
import ai.storyfork.content.work.client.WorkTagSuggestionClient
import ai.storyfork.content.work.client.dto.WorkTagSuggestionInput
import ai.storyfork.content.work.client.dto.WorkTagSuggestionOutput
import ai.storyfork.content.work.domain.WORK_GENRES
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkTagSuggestionService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.work.service.dto.WorkTagSuggestionResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension

/** #372 장르·키워드 추천을 DB·AI 서비스 없이 검증한다. 결과는 저장하지 않고 Content 규칙을 벗어난 후보는 실패로 알린다. */
@ExtendWith(MockitoExtension::class)
class WorkTagSuggestionServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var publications: PublicationService
    @Mock lateinit var client: WorkTagSuggestionClient
    @InjectMocks lateinit var service: WorkTagSuggestionService

    private val work = WorkAccessResult("w", "owner", "메밀꽃 필 무렵", "장돌뱅이 이야기", 4, "world", "private", false, false, null)
    private fun episode(number: Int, inherited: Boolean = false, body: String = "본문 $number") =
        PublishedEpisodeResponse(number, 1, "v$number", "제목 $number", body, inherited)
    private fun published(vararg items: PublishedEpisodeResponse) {
        `when`(access.get("w")).thenReturn(work)
        `when`(publications.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(items.toList()))
    }
    private val placeholder = WorkTagSuggestionInput("work-tags.v1", "", "", emptyList(), emptyList(), 0, 0)
    /** Kotlin 비 null 인자에 Mockito 매처의 null이 들어가지 않게 자리값을 돌려준다. */
    private fun anyInput(): WorkTagSuggestionInput = any(WorkTagSuggestionInput::class.java) ?: placeholder
    private fun captured(captor: ArgumentCaptor<WorkTagSuggestionInput>): WorkTagSuggestionInput = captor.capture() ?: placeholder
    private fun answer(genres: List<String>, hashtags: List<String>) =
        `when`(client.suggest(anyInput())).thenReturn(WorkTagSuggestionOutput("work-tags.v1", genres, hashtags))

    @Test
    fun `작가 본인 작품의 자기 발행 회차 앞 3개와 Content 장르 규칙을 보내고 후보만 돌려준다`() {
        published(episode(1, inherited = true), episode(2), episode(3, body = " "), episode(4), episode(5), episode(6, body = "가".repeat(9000)))
        answer(listOf("고전", "드라마"), listOf("장돌뱅이", "메밀꽃"))

        assertEquals(WorkTagSuggestionResponse(listOf("고전", "드라마"), listOf("장돌뱅이", "메밀꽃")), service.suggest("w", "owner"))

        val sent = ArgumentCaptor.forClass(WorkTagSuggestionInput::class.java)
        verify(client).suggest(captured(sent))
        with(sent.value) {
            assertEquals(listOf(2, 4, 5), episodes.map { it.number })
            assertEquals(Triple("메밀꽃 필 무렵", "장돌뱅이 이야기", WORK_GENRES), Triple(title, description, allowedGenres))
            assertEquals(2 to 10, maxGenres to maxHashtags)
        }
    }

    @Test
    fun `긴 회차는 서로게이트 쌍을 자르지 않고 앞부분만 보낸다`() {
        published(episode(1, body = "😀".repeat(9000)))
        answer(listOf("고전"), emptyList())
        service.suggest("w", "owner")
        val sent = ArgumentCaptor.forClass(WorkTagSuggestionInput::class.java)
        verify(client).suggest(captured(sent))
        val text = sent.value.episodes.single().text
        assertEquals(WorkTagSuggestionService.MAX_EPISODE_CHARS, text.codePointCount(0, text.length))
        assertEquals("😀".repeat(WorkTagSuggestionService.MAX_EPISODE_CHARS), text)
    }

    @Test
    fun `자기 발행 회차가 없으면 AI를 부르지 않고 409로 알린다`() {
        published(episode(1, inherited = true))
        val failure = assertThrows(ContentFailure::class.java) { service.suggest("w", "owner") }
        assertEquals(409, failure.status)
        verifyNoInteractions(client)
    }

    @Test
    fun `소유자가 아니면 404를 내고 작품에 쓰기 잠금을 걸지 않는다`() {
        `when`(access.get("w")).thenReturn(work)
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.suggest("w", "other") }.status)
        verifyNoInteractions(publications, client)
        verify(access, never()).own(anyString(), anyString())
    }

    @Test
    fun `삭제된 작품은 404로 알린다`() {
        `when`(access.get("w")).thenReturn(work.copy(deleted = true))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.suggest("w", "owner") }.status)
        verifyNoInteractions(publications, client)
    }

    @ParameterizedTest
    @CsvSource("AI_TIMEOUT,504", "AI_OUTPUT_INVALID,502", "AI_UNAVAILABLE,503", "AI_NOT_CONFIGURED,503", "AI_REQUEST_REJECTED,502")
    fun `AI 호출 실패는 가짜 추천 없이 상태로 알린다`(code: String, status: Int) {
        published(episode(1))
        `when`(client.suggest(anyInput())).thenThrow(WorkTagSuggestionCallFailure(code))
        val failure = assertThrows(ContentFailure::class.java) { service.suggest("w", "owner") }
        assertEquals(status to code, failure.status to failure.code)
    }

    @Test
    fun `승인 목록 밖 장르나 상한을 넘는 후보는 고치지 않고 실패로 알린다`() {
        val cases = listOf(
            listOf("무협외전") to emptyList<String>(),
            emptyList<String>() to emptyList<String>(),
            listOf("고전", "드라마", "현대") to emptyList<String>(),
            listOf("고전", "고전") to emptyList<String>(),
            listOf("고전") to (1..11).map { "키워드$it" },
            listOf("고전") to listOf("겹침", "겹침"),
            listOf("고전") to listOf(" 공백"),
            listOf("고전") to listOf("고전"),
        )
        for ((genres, hashtags) in cases) {
            reset(access, publications, client)
            published(episode(1))
            answer(genres, hashtags)
            val failure = assertThrows(ContentFailure::class.java) { service.suggest("w", "owner") }
            assertEquals(502 to "AI_OUTPUT_INVALID", failure.status to failure.code, "$genres $hashtags")
        }
    }
}
