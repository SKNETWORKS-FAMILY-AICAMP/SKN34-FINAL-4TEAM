package ai.storyfork.operations.alert

import ai.storyfork.operations.alert.entity.OperationAlertEntity
import org.hibernate.boot.MetadataSources
import org.hibernate.boot.registry.StandardServiceRegistryBuilder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Hibernate의 매핑 해석과 V8 SQL 텍스트만 본다. 데이터베이스 연결·Spring 컨텍스트가 없다. */
class AlertVersioningTest {
    @Test
    fun `an alert is versioned so a stale write is refused instead of overwriting the other admin`() {
        val registry = StandardServiceRegistryBuilder().applySetting("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect")
            .applySetting("hibernate.boot.allow_jdbc_metadata_access", "false").applySetting("hibernate.hbm2ddl.auto", "none").build()
        val binding = MetadataSources(registry).addAnnotatedClass(OperationAlertEntity::class.java).buildMetadata()
            .getEntityBinding(OperationAlertEntity::class.java.name)

        assertTrue(binding.isVersioned)
        assertEquals("version", binding.version.name)
    }

    @Test
    fun `the V8 alert table has the version column the entity maps`() {
        val sql = checkNotNull(javaClass.getResourceAsStream("/db/migration/operations/V8__llmops.sql")).use { String(it.readBytes(), Charsets.UTF_8) }
        val alertTable = sql.substringAfter("CREATE TABLE operations.operation_alert (").substringBefore("\n);")

        assertTrue(Regex("""\n\s+version BIGINT NOT NULL DEFAULT 0,""").containsMatchIn(alertTable), alertTable)
    }
}
