package ai.storyfork.core.content.config

import ai.storyfork.core.content.migration.V5__ImportLegacyContent
import jakarta.persistence.EntityManager
import jakarta.persistence.EntityManagerFactory
import javax.sql.DataSource
import org.flywaydb.core.Flyway
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization
import org.springframework.context.annotation.*
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.orm.jpa.*
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** Auth DataSource와 기존 콘텐츠 연결 설정을 분리한다. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.content.enabled"], havingValue = "true")
@EnableJpaRepositories(
    basePackages = ["ai.storyfork.core.work.repository", "ai.storyfork.core.episode.repository", "ai.storyfork.core.episode_version.repository", "ai.storyfork.core.publication.repository", "ai.storyfork.core.world.repository", "ai.storyfork.core.fork.repository", "ai.storyfork.core.proposal.repository"],
    entityManagerFactoryRef = "contentEntityManagerFactory",
    transactionManagerRef = "contentTransactionManager",
)
class ContentPersistenceConfig {
    @Bean
    @DependsOnDatabaseInitialization
    fun contentEntityManagerFactory(
        mapper: JsonMapper,
        @Value("\${CONTENT_DATABASE_URL}") url: String,
        @Value("\${CONTENT_DATABASE_USER}") user: String,
        @Value("\${CONTENT_DATABASE_PASSWORD}") password: String,
    ): LocalContainerEntityManagerFactoryBean {
        require(url.startsWith("jdbc:postgresql:")) { "Content storage requires PostgreSQL" }
        // Not a DataSource bean: Boot's existing Auth DataSource selection remains unchanged.
        val ds = DriverManagerDataSource(url, user, password)
        Flyway.configure().dataSource(ds).locations("classpath:db/migration/content")
            .javaMigrations(V5__ImportLegacyContent(mapper)).table("content_schema_history")
            .baselineOnMigrate(true).baselineVersion("0").validateOnMigrate(true).load().migrate()
        return LocalContainerEntityManagerFactoryBean().apply {
            dataSource = ds
            persistenceUnitName = "content"
            setPackagesToScan("ai.storyfork.core.work.entity", "ai.storyfork.core.episode.entity", "ai.storyfork.core.episode_version.entity", "ai.storyfork.core.publication.entity", "ai.storyfork.core.world.entity", "ai.storyfork.core.fork.entity", "ai.storyfork.core.proposal.entity")
            jpaVendorAdapter = HibernateJpaVendorAdapter()
            setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate", "hibernate.jdbc.time_zone" to "UTC"))
        }
    }


    @Bean
    fun contentTransactionManager(@Qualifier("contentEntityManagerFactory") factory: EntityManagerFactory) = JpaTransactionManager(factory)

    @Bean("contentTransactions")
    fun contentTransactions(@Qualifier("contentTransactionManager") manager: JpaTransactionManager) = TransactionTemplate(manager)

    @Bean("contentEntityManager")
    fun contentEntityManager(@Qualifier("contentEntityManagerFactory") factory: EntityManagerFactory): EntityManager = SharedEntityManagerCreator.createSharedEntityManager(factory)
}
