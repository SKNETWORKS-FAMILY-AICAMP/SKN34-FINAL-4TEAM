package ai.storyfork.content._common.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.datasource.DriverManagerDataSource

/** 현재와 동일한 DB 대상. WorldStudio를 위한 별도 DB/풀은 생성하지 않는다. */
@Configuration(proxyBeanMethods = false)
class ContentDatabaseConfig {
    @Bean
    fun contentDataSource(@Value("\${DATABASE_URL}") url: String,
        @Value("\${DATABASE_USER}") user: String,
        @Value("\${DATABASE_PASSWORD}") password: String): DriverManagerDataSource {
        require(url.startsWith("jdbc:postgresql:")) { "Content storage requires PostgreSQL" }
        return DriverManagerDataSource(url, user, password)
    }
}
