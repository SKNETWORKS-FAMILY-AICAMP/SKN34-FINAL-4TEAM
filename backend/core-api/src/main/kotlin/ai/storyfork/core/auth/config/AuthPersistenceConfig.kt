package ai.storyfork.core.auth.config

import ai.storyfork.core.auth.entity.AuthMember
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

@Configuration(proxyBeanMethods = false)
@EntityScan(basePackageClasses = [AuthMember::class])
@EnableJpaRepositories(basePackages = ["ai.storyfork.core.auth.repository"])
class AuthPersistenceConfig {
    @org.springframework.context.annotation.Bean
    @org.springframework.context.annotation.Primary
    @org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization
    fun entityManagerFactory(dataSource: javax.sql.DataSource): org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean =
        org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean().apply {
            this.dataSource = dataSource
            persistenceUnitName = "auth"
            setPackagesToScan(AuthMember::class.java.packageName)
            jpaVendorAdapter = org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter()
            setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate", "hibernate.jdbc.time_zone" to "UTC"))
        }
    @org.springframework.context.annotation.Bean
    @org.springframework.context.annotation.Primary
    fun transactionManager(@org.springframework.beans.factory.annotation.Qualifier("entityManagerFactory") factory: jakarta.persistence.EntityManagerFactory) = org.springframework.orm.jpa.JpaTransactionManager(factory)
}
