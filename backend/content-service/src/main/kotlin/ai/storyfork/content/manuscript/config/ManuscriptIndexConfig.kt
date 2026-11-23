package ai.storyfork.content.manuscript.config

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content._common.helper.validateHttpBaseUrl
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.manuscript.client.ManuscriptElasticsearch
import ai.storyfork.content.manuscript.client.ManuscriptEmbeddingClient
import ai.storyfork.content.manuscript.service.ManuscriptIndexJob
import ai.storyfork.content.manuscript.service.ManuscriptIndexSync
import java.net.URI
import java.time.Duration
import javax.sql.DataSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper

/** 원고 색인(Elasticsearch)·대조 작업·검색 서비스는 어느 환경에서나 항상 켠다(2026-11-22 사용자 결정, 끄는 플래그 없음). 색인이 없으면 시작할 때 만들고 매핑이 다르면 Content가 시작하지 않는다. */
@Configuration(proxyBeanMethods = false)
internal class ManuscriptIndexConfig {
    @Bean("manuscriptIndexScheduler", defaultCandidate = false)
    fun scheduler() = ThreadPoolTaskScheduler().apply { setThreadNamePrefix("manuscript-index-") }

    @Bean
    fun manuscriptElasticsearch(
        builder: RestClient.Builder,
        mapper: JsonMapper,
        @Value("\${MANUSCRIPT_INDEX_URL:http://127.0.0.1:9200}") url: URI,
        @Value("\${MANUSCRIPT_INDEX_NAME:storyfork-manuscript-v1}") indexName: String,
    ): ManuscriptElasticsearch {
        validateHttpBaseUrl(url, "MANUSCRIPT_INDEX_URL")
        // 최초 생성·매핑 불일치 실패는 Content 시작을 막아 배포 --wait가 실패로 드러낸다.
        return ManuscriptElasticsearch(buildRestClient(builder.clone(), url, Duration.ofSeconds(2), Duration.ofSeconds(15)), mapper, indexName)
            .also { it.ensureIndex(ClassPathResource("manuscript/manuscript-chunks-v1.json").getContentAsString(Charsets.UTF_8)) }
    }

    @Bean
    fun manuscriptEmbeddingClient(
        builder: RestClient.Builder, ai: AiServiceClientProperties, @Value("\${INTERNAL_TOKEN:}") token: String,
    ): ManuscriptEmbeddingClient {
        require(token.isNotBlank()) { "INTERNAL_TOKEN is required for manuscript indexing" }
        return ManuscriptEmbeddingClient(buildRestClient(builder.clone(), ai.baseUrl, ai.connectTimeout, Duration.ofSeconds(45)), token)
    }

    @Bean
    fun manuscriptIndexJob(
        @Qualifier("contentDataSource") dataSource: DataSource,
        @Qualifier("contentTransactions") transactions: TransactionTemplate,
        index: ManuscriptElasticsearch, embeddings: ManuscriptEmbeddingClient,
    ) = ManuscriptIndexJob(JdbcClient.create(dataSource), transactions, ManuscriptIndexSync(index, embeddings))

    @Bean
    fun manuscriptQaService(
        scopes: QaScopeService, index: ManuscriptElasticsearch, embeddings: ManuscriptEmbeddingClient,
        episodes: EpisodeCurrentRepository, versions: EpisodeVersionRepository,
        grants: QaScopeGrants,
    ) = ManuscriptQaService(scopes, index, embeddings, episodes, versions, grants)
}
