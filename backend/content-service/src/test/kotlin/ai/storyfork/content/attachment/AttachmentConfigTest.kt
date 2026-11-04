package ai.storyfork.content.attachment

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.work.entity.MemberEntity
import ai.storyfork.content.work.repository.MemberRepository
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

@EnabledIfEnvironmentVariable(named="TEST_ATTACHMENT_DATABASE_URL",matches=".+")
class AttachmentConfigTest {
    @Test fun `attachment pool is bounded managed and separate from content transaction`() {
        val url=System.getenv("TEST_ATTACHMENT_DATABASE_URL")
        lateinit var pool:HikariDataSource
        SpringApplicationBuilder(ContentServiceApplication::class.java).run(
            "--server.port=0","--app.content.enabled=true","--app.setting-attachments.enabled=true",
            "--CONTENT_DATABASE_URL=$url","--CONTENT_DATABASE_USER=content_test","--CONTENT_DATABASE_PASSWORD=",
            "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
            "--app.setting-attachments.bucket=issue87-test","--app.setting-attachments.region=us-east-1",
            "--app.setting-attachments.endpoint=http://127.0.0.1:19087",
        ).use { context ->
            val factory=context.getBean("&attachmentEntityManagerFactory",LocalContainerEntityManagerFactoryBean::class.java)
            pool=assertInstanceOf(HikariDataSource::class.java,factory.dataSource)
            assertSame(pool,context.getBean("attachmentDataSource"));assertEquals(url,pool.jdbcUrl)
            assertEquals("content_test",pool.username);assertEquals("",pool.password)
            assertEquals(5,pool.maximumPoolSize);assertEquals(2_000L,pool.connectionTimeout);assertFalse(pool.isClosed)
            pool.connection.use { assertTrue(it.isValid(2)) }
            val contentSource=context.getBean("contentDataSource",DataSource::class.java)
            val manager=context.getBean("contentTransactionManager",JpaTransactionManager::class.java)
            val attachmentManager=context.getBean("attachmentTransactionManager",JpaTransactionManager::class.java)
            assertNotSame(pool,contentSource);assertSame(contentSource,manager.dataSource)
            assertSame(context.getBean("contentEntityManagerFactory"),manager.entityManagerFactory)
            assertSame(pool,attachmentManager.dataSource);assertNotSame(manager,attachmentManager)
            assertTrue(manager.entityManagerFactory!!.metamodel.entities.none { it.javaType.packageName.contains(".auth.") })
            val members=context.getBean(MemberRepository::class.java);val id=UUID.randomUUID().toString()
            TransactionTemplate(manager).executeWithoutResult { status -> members.saveAndFlush(MemberEntity(id));status.setRollbackOnly() }
            assertFalse(members.existsById(id))
        }
        assertTrue(pool.isClosed)
    }
}
