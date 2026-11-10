package ai.storyfork.content._common.config

import jakarta.persistence.EntityManager
import jakarta.persistence.EntityManagerFactory
import javax.sql.DataSource
import org.flywaydb.core.Flyway
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.context.annotation.*
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.orm.jpa.*
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.transaction.support.TransactionTemplate

/** 같은 DB 대상에서 콘텐츠만 소유한다. 새 개발 스키마 전용이며 기존 이력을 자동 repair하지 않는다. */
@Configuration(proxyBeanMethods = false)
@org.springframework.transaction.annotation.EnableTransactionManagement
@EnableJpaRepositories(
    basePackages = ["ai.storyfork.content.work.repository", "ai.storyfork.content.episode.repository", "ai.storyfork.content.episode_version.repository", "ai.storyfork.content.publication.repository", "ai.storyfork.content.world.repository", "ai.storyfork.content.fork.repository", "ai.storyfork.content.proposal.repository", "ai.storyfork.content.plan.repository", "ai.storyfork.content.comment.repository", "ai.storyfork.content.like.repository", "ai.storyfork.content.interest.repository", "ai.storyfork.content.reading.repository", "ai.storyfork.content.editsuggestion.repository"],
    entityManagerFactoryRef = "contentEntityManagerFactory",
    transactionManagerRef = "contentTransactionManager",
)
class ContentPersistenceConfig {
    companion object {
        // One history, globally ordered versions; never scan the root or other owners' leaves.
        val MIGRATION_LOCATIONS = arrayOf(
            "classpath:db/migration/work", "classpath:db/migration/episode",
            "classpath:db/migration/world", "classpath:db/migration/episode_version",
            "classpath:db/migration/publication", "classpath:db/migration/fork",
            "classpath:db/migration/proposal",
            "classpath:db/migration/plan",
            // Development sample rows (generated from infrastructure/sample-data CSV), same global version order.
            "classpath:db/migration/sample",
        )
    }

    @Bean
    fun contentEntityManagerFactory(
        @Qualifier("contentDataSource") ds: DataSource,
    ): LocalContainerEntityManagerFactoryBean {
        Flyway.configure().dataSource(ds).locations(*MIGRATION_LOCATIONS)
            .table("content_schema_history")
            .baselineOnMigrate(true).baselineVersion("0").validateOnMigrate(true).load().migrate()
        return LocalContainerEntityManagerFactoryBean().apply {
            dataSource = ds
            persistenceUnitName = "content"
            setPackagesToScan("ai.storyfork.content.work.entity", "ai.storyfork.content.episode.entity", "ai.storyfork.content.episode_version.entity", "ai.storyfork.content.publication.entity", "ai.storyfork.content.world.entity", "ai.storyfork.content.fork.entity", "ai.storyfork.content.proposal.entity", "ai.storyfork.content.plan.entity", "ai.storyfork.content.comment.entity", "ai.storyfork.content.like.entity", "ai.storyfork.content.interest.entity", "ai.storyfork.content.reading.entity", "ai.storyfork.content.editsuggestion.entity")
            jpaVendorAdapter = HibernateJpaVendorAdapter()
            setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate", "hibernate.jdbc.time_zone" to "UTC"))
        }
    }


    @Bean
    fun contentTransactionManager(@Qualifier("contentEntityManagerFactory") factory: EntityManagerFactory) = JpaTransactionManager(factory)

    @Bean(name=["contentTransactions"], defaultCandidate=false)
    fun contentTransactions(@Qualifier("contentTransactionManager") manager: JpaTransactionManager) = TransactionTemplate(manager)

    @Bean("contentEntityManager")
    fun contentEntityManager(@Qualifier("contentEntityManagerFactory") factory: EntityManagerFactory): EntityManager = SharedEntityManagerCreator.createSharedEntityManager(factory)
}
