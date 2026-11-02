package ai.storyfork.core.content

import ai.storyfork.core.content.client.GenerationClient
import ai.storyfork.core.content.repository.ContentRepository
import ai.storyfork.core.content.service.ContentService
import org.flywaydb.core.Flyway
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.support.JdbcTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["app.content.enabled"],havingValue="true")
class ContentConfig {
    @Bean fun contentRepository(mapper: JsonMapper, @Value("\${CONTENT_DATABASE_URL}") url: String, @Value("\${CONTENT_DATABASE_USER}") user: String, @Value("\${CONTENT_DATABASE_PASSWORD}") password: String): ContentRepository {
        require(url.startsWith("jdbc:postgresql:")) { "Content storage requires PostgreSQL" }
        val dataSource=DriverManagerDataSource(url,user,password)
        Flyway.configure().dataSource(dataSource).locations("classpath:db/content").table("content_schema_history").load().migrate()
        return ContentRepository(JdbcTemplate(dataSource),TransactionTemplate(JdbcTransactionManager(dataSource)),mapper)
    }
    @Bean fun generationClient(aiServiceRestClient: RestClient,@Value("\${INTERNAL_TOKEN:}") token: String) = GenerationClient(aiServiceRestClient,token)
    @Bean fun contentService(repository: ContentRepository,client: GenerationClient,mapper: JsonMapper) = ContentService(repository,client,mapper)
}
