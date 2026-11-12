package ai.storyfork.content.manuscript.config

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content._common.helper.validateHttpBaseUrl
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.manuscript.client.ManuscriptElasticsearch
import ai.storyfork.content.manuscript.client.ManuscriptEmbeddingClient
import ai.storyfork.content.manuscript.client.ManuscriptQaClient
import ai.storyfork.content.manuscript.service.ManuscriptIndexJob
import ai.storyfork.content.manuscript.service.ManuscriptIndexSync
import ai.storyfork.content.world.service.WorldService
import java.net.URI
import java.time.Duration
import javax.sql.DataSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.manuscript-index.enabled"], havingValue = "true")
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
        return ManuscriptElasticsearch(buildRestClient(builder.clone(), url, Duration.ofSeconds(2), Duration.ofSeconds(15)), mapper, indexName)
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
        episodes: EpisodeCurrentRepository, versions: EpisodeVersionRepository, worlds: WorldService,
        builder: RestClient.Builder, ai: AiServiceClientProperties, @Value("\${INTERNAL_TOKEN:}") token: String,
    ) = ManuscriptQaService(scopes, index, embeddings, episodes, versions,
        ManuscriptQaClient(buildRestClient(builder.clone(), ai.baseUrl, ai.connectTimeout, Duration.ofSeconds(45)), token), worlds)
}
