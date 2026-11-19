package ai.storyfork.content._common.helper

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.manuscript.client.ManuscriptElasticsearch
import ai.storyfork.content.manuscript.client.ManuscriptEmbeddingClient
import ai.storyfork.content.manuscript.config.ManuscriptIndexConfig
import ai.storyfork.content.proposal.config.GenerationClientConfig
import ai.storyfork.content.work.WorkTagSuggestionConfig
import ai.storyfork.content.world.InitialWorldExtractionConfig
import ai.storyfork.content.world.service.WorldService
import java.net.URI
import java.time.Duration
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.web.client.RestClient

/**
 * 회원이 시작하는 AI 호출(제안·새 원고·부분 수정, 장르·키워드 추천, 초기 세계관·설정집 검토, 원고 Q&A)의 클라이언트가 설정에서
 * 회원 Bearer를 싣도록 만들어졌는지 확인한다(DEC-55). 색인용 임베딩 호출은 백그라운드와 같이 쓰이므로 싣지 않는다. 전송 없이 클라이언트 설정만 본다.
 */
class AiUserBearerWiringTest {
    private val ai = AiServiceClientProperties(URI("http://127.0.0.1:9"), Duration.ofSeconds(1), Duration.ofSeconds(5))

    private fun field(owner: Any, name: String): Any = owner.javaClass.getDeclaredField(name).also { it.isAccessible = true }.get(owner)

    private fun forwards(client: Any, name: String): Boolean {
        var seen = emptyList<ClientHttpRequestInterceptor>()
        (field(client, name) as RestClient).mutate().requestInterceptors { seen = it.toList() }
        return UserBearerInterceptor in seen
    }

    @Test fun `every AI client a member's request starts forwards the member's bearer`() {
        val generation = GenerationClientConfig().generationClient(RestClient.builder(), ai, Duration.ofSeconds(5), "token")
        val tags = WorkTagSuggestionConfig().workTagSuggestionClient(RestClient.builder(), ai, "token")
        val world = InitialWorldExtractionConfig().initialWorldExtractionClient(RestClient.builder(), ai, "token")
        val qa = ManuscriptIndexConfig().manuscriptQaService(mock(QaScopeService::class.java), mock(ManuscriptElasticsearch::class.java), mock(ManuscriptEmbeddingClient::class.java),
            mock(EpisodeCurrentRepository::class.java), mock(EpisodeVersionRepository::class.java), mock(WorldService::class.java), RestClient.builder(), ai, "token", QaScopeGrants())

        assertTrue(forwards(generation, "client"), "제안·새 원고·부분 수정")
        assertTrue(forwards(tags, "client"), "장르·키워드 추천")
        assertTrue(forwards(world, "client"), "초기 세계관·설정집 검토")
        assertTrue(forwards(field(qa, "answers"), "http"), "원고 Q&A")
    }

    @Test fun `the embedding client used by indexing does not forward a bearer`() {
        val embeddings = ManuscriptIndexConfig().manuscriptEmbeddingClient(RestClient.builder(), ai, "token")

        assertFalse(forwards(embeddings, "http"))
    }
}
