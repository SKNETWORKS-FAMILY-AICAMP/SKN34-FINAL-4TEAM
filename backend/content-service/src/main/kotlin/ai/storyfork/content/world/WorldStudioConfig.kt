package ai.storyfork.content.world

import ai.storyfork.content.world.studio.entity.StudioWorld
import jakarta.persistence.EntityManagerFactory
import javax.sql.DataSource
import org.flywaydb.core.Flyway
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.orm.jpa.JpaTransactionManager
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.transaction.annotation.EnableTransactionManagement

/** 전용 schema/이력(world_studio_schema_history)을 서버 시작 시 migrate한 뒤 validate한다. Auth를 스캔하지 않는다. */
@Configuration(proxyBeanMethods = false)
@EnableTransactionManagement
@EnableJpaRepositories(basePackages = ["ai.storyfork.content.world.studio.repository"],
    entityManagerFactoryRef = "worldStudioEntityManagerFactory", transactionManagerRef = "worldStudioTransactionManager")
class WorldStudioConfig {
    @Bean(defaultCandidate = false)
    fun worldStudioEntityManagerFactory(@Qualifier("contentDataSource") source: DataSource): LocalContainerEntityManagerFactoryBean {
        // Content 이력과 같은 방식으로 시작 시 적용한다. repair·clean·baseline은 하지 않아 미확인 schema면 기동이 멈춘다.
        Flyway.configure().dataSource(source).locations("classpath:db/migration/worldstudio")
            .schemas("worldstudio").defaultSchema("worldstudio").table("world_studio_schema_history")
            .cleanDisabled(true).baselineOnMigrate(false).validateOnMigrate(true).load().migrate()
        return LocalContainerEntityManagerFactoryBean().apply {
            dataSource = source
            persistenceUnitName = "worldstudio"
            setPackagesToScan(StudioWorld::class.java.packageName)
            jpaVendorAdapter = HibernateJpaVendorAdapter()
            setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate", "hibernate.jdbc.time_zone" to "UTC"))
        }
    }

    @Bean(defaultCandidate = false)
    fun worldStudioTransactionManager(@Qualifier("worldStudioEntityManagerFactory") factory: EntityManagerFactory) = JpaTransactionManager(factory)
}
