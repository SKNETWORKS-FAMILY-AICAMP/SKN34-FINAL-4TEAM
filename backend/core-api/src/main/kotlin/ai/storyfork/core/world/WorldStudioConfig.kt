package ai.storyfork.core.world

import ai.storyfork.core.world.entity.StudioWorld
import ai.storyfork.core.world.repository.*
import ai.storyfork.core.world.service.WorldStudioService
import com.zaxxer.hikari.HikariDataSource
import jakarta.persistence.EntityManagerFactory
import javax.sql.DataSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.orm.jpa.JpaTransactionManager
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.transaction.support.TransactionTemplate

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["app.worldstudio.enabled"],havingValue="true")
@EnableJpaRepositories(basePackages=["ai.storyfork.core.world.repository"],
    entityManagerFactoryRef="worldStudioEntityManagerFactory",transactionManagerRef="worldStudioTransactionManager")
class WorldStudioConfig {
    @Bean(defaultCandidate=false,destroyMethod="close")
    fun worldStudioDataSource(@Value("\${WORLDSTUDIO_DATABASE_URL}") url:String,
        @Value("\${WORLDSTUDIO_DATABASE_USER}") user:String,
        @Value("\${WORLDSTUDIO_DATABASE_PASSWORD}") password:String): HikariDataSource {
        require(url.startsWith("jdbc:postgresql:")) { "WorldStudio requires PostgreSQL" }
        return HikariDataSource().apply {
            jdbcUrl=url;username=user;this.password=password;maximumPoolSize=5;connectionTimeout=2_000
            addDataSourceProperty("logServerErrorDetail","false")
        }
    }
    // Explicit migration precedes activation; normal startup never creates or migrates this schema.
    @Bean(defaultCandidate=false)
    fun worldStudioEntityManagerFactory(@Qualifier("worldStudioDataSource") source:DataSource)=LocalContainerEntityManagerFactoryBean().apply {
        dataSource=source;persistenceUnitName="worldstudio"
        setPackagesToScan(StudioWorld::class.java.packageName)
        jpaVendorAdapter=HibernateJpaVendorAdapter()
        setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate","hibernate.jdbc.time_zone" to "UTC"))
    }
    @Bean(defaultCandidate=false)
    fun worldStudioTransactionManager(@Qualifier("worldStudioEntityManagerFactory") factory:EntityManagerFactory)=JpaTransactionManager(factory)

    @Bean fun worldStudioService(worlds:WorldRepository,drafts:WorldDraftRepository,cards:SettingCardRepository,
        cardDrafts:SettingCardDraftRepository,cardVersions:SettingCardVersionRepository,relationships:RelationshipRepository,
        relationDrafts:RelationshipDraftRepository,relationVersions:RelationshipVersionRepository,revisions:WorldRevisionRepository,
        revisionCards:WorldRevisionCardRepository,revisionRelations:WorldRevisionRelationshipRepository,requests:WorldSaveRequestRepository,
        @Qualifier("worldStudioTransactionManager") manager:JpaTransactionManager)=WorldStudioService(worlds,drafts,cards,cardDrafts,
        cardVersions,relationships,relationDrafts,relationVersions,revisions,revisionCards,revisionRelations,requests,TransactionTemplate(manager))
}
