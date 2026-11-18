package ai.storyfork.content.search.config

import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content._common.helper.validateHttpBaseUrl
import ai.storyfork.content.search.client.SearchElasticsearch
import ai.storyfork.content.search.service.SearchIndexJob
import ai.storyfork.content.search.service.SearchIndexSync
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.world.service.PublicWorldService
import java.net.URI
import java.time.Duration
import javax.sql.DataSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper

/**
 * 검색 색인(#505)은 `app.search-index.enabled=true`일 때만 켠다. 꺼져 있으면 이 빈들이 없어 [ai.storyfork.content.search.service.SearchCandidates]가 늘 null을 돌려주고
 * 검색은 지금 DB 경로 그대로다(로컬·Elasticsearch 없는 CI).
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.search-index.enabled"], havingValue = "true")
internal class SearchIndexConfig {
    @Bean("searchIndexScheduler", defaultCandidate = false)
    fun scheduler() = ThreadPoolTaskScheduler().apply { setThreadNamePrefix("search-index-") }

    @Bean
    fun searchElasticsearch(builder: RestClient.Builder, mapper: JsonMapper, @Value("\${app.search-index.url}") url: URI): SearchElasticsearch {
        validateHttpBaseUrl(url, "SEARCH_INDEX_URL")
        // 최초 생성·매핑 불일치 실패는 Content 시작을 막아 배포 --wait가 실패로 드러낸다(원고 색인과 같다).
        return SearchElasticsearch(buildRestClient(builder.clone(), url, Duration.ofSeconds(2), Duration.ofSeconds(15)), mapper)
            .also { it.ensureIndex(ClassPathResource("search/search-v1.json").getContentAsString(Charsets.UTF_8)) }
    }

    @Bean
    fun searchIndexJob(
        @Qualifier("contentDataSource") dataSource: DataSource, index: SearchElasticsearch, works: WorkService, worlds: PublicWorldService,
    ) = SearchIndexJob(dataSource, works, worlds, SearchIndexSync(index))
}
