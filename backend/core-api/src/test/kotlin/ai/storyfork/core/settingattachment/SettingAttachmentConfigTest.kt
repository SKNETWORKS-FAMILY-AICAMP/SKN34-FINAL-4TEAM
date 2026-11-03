package ai.storyfork.core.settingattachment

import ai.storyfork.core.CoreApiApplication
import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import com.zaxxer.hikari.HikariDataSource
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.orm.jpa.JpaTransactionManager
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean
import org.springframework.transaction.support.TransactionTemplate

@EnabledIfEnvironmentVariable(named = "TEST_ATTACHMENT_DATABASE_URL", matches = ".+")
class SettingAttachmentConfigTest {
    @Test fun `attachment pool is bounded Spring managed and separate from Auth`() {
        val url = System.getenv("TEST_ATTACHMENT_DATABASE_URL")
        lateinit var pool: HikariDataSource
        SpringApplicationBuilder(CoreApiApplication::class.java).run(
            "--server.port=0", "--app.content.enabled=true", "--app.setting-attachments.enabled=true",
            "--spring.datasource.url=$url", "--spring.datasource.username=content_test", "--spring.datasource.password=",
            "--CONTENT_DATABASE_URL=$url", "--CONTENT_DATABASE_USER=content_test", "--CONTENT_DATABASE_PASSWORD=",
            "--spring.mail.host=127.0.0.1", "--spring.mail.port=1",
            "--app.auth.public-origin=http://localhost:5173", "--app.auth.mail-from=test@example.invalid",
            "--AUTH_JWT_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "--AUTH_COOKIE_SECURE=false",
            "--app.setting-attachments.bucket=issue87-test", "--app.setting-attachments.region=us-east-1",
            "--app.setting-attachments.endpoint=http://127.0.0.1:19087",
        ).use { context ->
            val factory = context.getBean("&attachmentEntityManagerFactory", LocalContainerEntityManagerFactoryBean::class.java)
            pool = assertInstanceOf(HikariDataSource::class.java, factory.dataSource)
            assertSame(pool, context.getBean("attachmentDataSource"))
            assertEquals(url, pool.jdbcUrl)
            assertEquals("content_test", pool.username)
            assertEquals("", pool.password)
            assertEquals(5, pool.maximumPoolSize)
            assertEquals(2_000L, pool.connectionTimeout)
            assertFalse(pool.isClosed)
            pool.connection.use { assertTrue(it.isValid(2)) }

            val authSource = context.getBean(DataSource::class.java)
            assertNotSame(pool, authSource)
            val authManager = context.getBean(JpaTransactionManager::class.java)
            assertSame(authSource, authManager.dataSource)
            assertSame(context.getBean("entityManagerFactory"), authManager.entityManagerFactory)
            val attachmentManager = context.getBean("attachmentTransactionManager", JpaTransactionManager::class.java)
            assertSame(pool, attachmentManager.dataSource)
            assertNotSame(authManager, attachmentManager)
            assertEquals(setOf(AuthMember::class.java.packageName), requireNotNull(authManager.entityManagerFactory)
                .metamodel.entities.map { it.javaType.packageName }.toSet())
            val members = context.getBean(MemberRepository::class.java)
            val id = UUID.randomUUID()
            context.getBean(TransactionTemplate::class.java).executeWithoutResult { status ->
                members.saveAndFlush(AuthMember(id, "$id@example.invalid", "unused", "Rolled back"))
                status.setRollbackOnly()
            }
            assertFalse(members.existsById(id))
        }
        assertTrue(pool.isClosed)
    }
}
