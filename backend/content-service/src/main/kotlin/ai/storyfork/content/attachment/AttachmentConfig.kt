package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.entity.SettingAttachment
import com.zaxxer.hikari.HikariDataSource
import java.net.URI
import java.time.Duration
import javax.sql.DataSource
import org.flywaydb.core.Flyway
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
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
@EnableConfigurationProperties(AttachmentProperties::class)
@EnableJpaRepositories(basePackages = ["ai.storyfork.content.attachment.repository"],
    entityManagerFactoryRef = "attachmentEntityManagerFactory", transactionManagerRef = "attachmentTransactionManager")
class AttachmentConfig {
    @Bean(destroyMethod = "close")
    fun attachmentS3Client(properties: AttachmentProperties): S3Client {
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

    // 사용자 지정 endpoint(MinIO)일 때만 버킷을 만든다. AWS S3 버킷은 운영자가 준비한다.
    @Bean fun attachmentStorageClient(s3: S3Client, properties: AttachmentProperties) = AttachmentStorageClient(s3, properties.bucket)
        .also { if (properties.endpoint.isNotBlank()) it.ensureBucket() }

    @Bean(defaultCandidate = false, destroyMethod = "close")
    fun attachmentDataSource(
        @Value("\${DATABASE_URL}") url: String,
        @Value("\${DATABASE_USER}") user: String,
        @Value("\${DATABASE_PASSWORD}") password: String,
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

    // Preserve the independent attachment transaction boundary and histories on the content-owned database.
    @Bean(defaultCandidate = false)
    @DependsOn("contentEntityManagerFactory")
    fun attachmentEntityManagerFactory(
        @Qualifier("attachmentDataSource") source: DataSource,
    ): LocalContainerEntityManagerFactoryBean {
        Flyway.configure().dataSource(source).locations("classpath:db/migration/settingattachment")
            .table("setting_attachment_schema_history").baselineOnMigrate(true).baselineVersion("0").load().migrate()
        Flyway.configure().dataSource(source).locations("classpath:db/migration/contentimage")
            .table("content_image_schema_history").baselineOnMigrate(true).baselineVersion("0").load().migrate()
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
