package ai.storyfork.content.world

import ai.storyfork.content.world.studio.entity.StudioWorld
import jakarta.persistence.EntityManagerFactory
import javax.sql.DataSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.orm.jpa.JpaTransactionManager
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.transaction.annotation.EnableTransactionManagement

/** 전용 schema/이력은 유지한다. 명시적 이관 명령 완료 후 validate만 수행하며 Auth를 스캔하지 않는다. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.worldstudio.enabled"], havingValue = "true")
@EnableTransactionManagement
@EnableJpaRepositories(basePackages = ["ai.storyfork.content.world.studio.repository"],
    entityManagerFactoryRef = "worldStudioEntityManagerFactory", transactionManagerRef = "worldStudioTransactionManager")
class WorldStudioConfig {
    @Bean(defaultCandidate = false)
    fun worldStudioEntityManagerFactory(@Qualifier("contentDataSource") source: DataSource) = LocalContainerEntityManagerFactoryBean().apply {
        dataSource = source
        persistenceUnitName = "worldstudio"
        setPackagesToScan(StudioWorld::class.java.packageName)
        jpaVendorAdapter = HibernateJpaVendorAdapter()
        setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate", "hibernate.jdbc.time_zone" to "UTC"))
    }

    @Bean(defaultCandidate = false)
    fun worldStudioTransactionManager(@Qualifier("worldStudioEntityManagerFactory") factory: EntityManagerFactory) = JpaTransactionManager(factory)
}
