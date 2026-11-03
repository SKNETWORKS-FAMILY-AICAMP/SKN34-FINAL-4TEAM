package ai.storyfork.core.settingattachment

import ai.storyfork.core.settingattachment.client.AttachmentStorageClient
import ai.storyfork.core.settingattachment.entity.SettingAttachment
import com.zaxxer.hikari.HikariDataSource
import java.net.URI
import java.time.Duration
import javax.sql.DataSource
import org.flywaydb.core.Flyway
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.*
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.orm.jpa.JpaTransactionManager
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter
import org.springframework.transaction.support.TransactionTemplate
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.content.enabled", "app.setting-attachments.enabled"], havingValue = "true")
@EnableConfigurationProperties(SettingAttachmentProperties::class)
@EnableJpaRepositories(basePackages = ["ai.storyfork.core.settingattachment.repository"],
    entityManagerFactoryRef = "attachmentEntityManagerFactory", transactionManagerRef = "attachmentTransactionManager")
class SettingAttachmentConfig {
    @Bean(destroyMethod = "close")
    fun attachmentS3Client(properties: SettingAttachmentProperties): S3Client {
        require(properties.bucket.matches(Regex("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]"))) { "A private attachment bucket is required" }
        val builder = S3Client.builder().region(Region.of(properties.region))
            .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(2)).socketTimeout(Duration.ofSeconds(10)))
            .overrideConfiguration { it.apiCallTimeout(Duration.ofSeconds(20)).apiCallAttemptTimeout(Duration.ofSeconds(12)) }
        if (properties.endpoint.isNotBlank()) {
            val uri = URI.create(properties.endpoint)
            require(uri.scheme in setOf("http", "https") && uri.host != null && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path in listOf("", "/")) { "Invalid attachment endpoint" }
            require(uri.scheme == "https" || uri.host in setOf("127.0.0.1", "localhost", "minio")) { "HTTP attachment endpoint is local-only" }
            builder.endpointOverride(uri).forcePathStyle(true)
        }
        // AWS default credentials chain: local env credentials or production role/profile; never public ACLs.
        return builder.build()
    }

    @Bean fun attachmentStorageClient(s3: S3Client, properties: SettingAttachmentProperties) = AttachmentStorageClient(s3, properties.bucket)

    @Bean(defaultCandidate = false, destroyMethod = "close")
    fun attachmentDataSource(
        @Value("\${CONTENT_DATABASE_URL}") url: String,
        @Value("\${CONTENT_DATABASE_USER}") user: String,
        @Value("\${CONTENT_DATABASE_PASSWORD}") password: String,
    ): HikariDataSource {
        require(url.startsWith("jdbc:postgresql:")) { "Attachment storage requires PostgreSQL" }
        return HikariDataSource().apply {
            jdbcUrl = url
            username = user
            this.password = password
            maximumPoolSize = 5
            connectionTimeout = 2_000
        }
    }

    // Keep Boot's default Auth persistence unit; attachments use the separately qualified Content database.
    @Bean(defaultCandidate = false)
    @DependsOn("flywayInitializer", "contentRepository")
    fun attachmentEntityManagerFactory(
        @Qualifier("attachmentDataSource") source: DataSource,
    ): LocalContainerEntityManagerFactoryBean {
        Flyway.configure().dataSource(source).locations("classpath:db/migration/settingattachment")
            .table("setting_attachment_schema_history").baselineOnMigrate(true).baselineVersion("0").load().migrate()
        return LocalContainerEntityManagerFactoryBean().apply {
            dataSource = source
            persistenceUnitName = "setting-attachments"
            setPackagesToScan(SettingAttachment::class.java.packageName)
            jpaVendorAdapter = HibernateJpaVendorAdapter()
            setJpaPropertyMap(mapOf("hibernate.hbm2ddl.auto" to "validate", "hibernate.jdbc.time_zone" to "UTC"))
        }
    }

    @Bean(defaultCandidate = false) fun attachmentTransactionManager(@Qualifier("attachmentEntityManagerFactory") factory: jakarta.persistence.EntityManagerFactory) = JpaTransactionManager(factory)
    @Bean(defaultCandidate = false) fun attachmentTransactions(@Qualifier("attachmentTransactionManager") manager: JpaTransactionManager) = TransactionTemplate(manager)
}
