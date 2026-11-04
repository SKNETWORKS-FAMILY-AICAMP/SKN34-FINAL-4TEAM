package ai.storyfork.core.world.migration

import org.flywaydb.core.Flyway
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import org.slf4j.LoggerFactory
import java.sql.DriverManager
import java.util.Properties
import kotlin.system.exitProcess

/** Core 서버 시작과 분리된 일회성 개발 배포 명령. 실패 시 원인 객체/접속 정보를 출력하지 않는다. */
object WorldStudioMigration {
    @JvmStatic
    fun main(args: Array<String>) {
        try {
            // 별도 명령 프로세스에서만 URL이 포함된 Flyway 로그를 억제한다.
            (LoggerFactory.getLogger("org.flywaydb") as Logger).level = Level.OFF
            val applied = migrate(WorldStudioMigrationProperties.from(System.getenv()))
            println("WorldStudio migration validated; applied=$applied; pending=0; tables=12")
        } catch (_: Exception) {
            System.err.println("WorldStudio migration failed; Core deployment must stop. Check target, backup approval, permissions and history privately.")
            exitProcess(1)
        }
    }

    fun migrate(settings: WorldStudioMigrationProperties): Int {
        val credentials = Properties().apply {
            setProperty("user", settings.user)
            setProperty("password", settings.password)
            setProperty("logServerErrorDetail", "false")
            setProperty("connectTimeout", "10")
            setProperty("socketTimeout", "60")
        }
        DriverManager.getConnection(settings.url, credentials).use { connection ->
            connection.isReadOnly = true
            connection.autoCommit = false
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT current_database(), current_user, has_database_privilege(current_database(), 'CREATE')").use {
                    check(it.next() && it.getString(1) == settings.database && it.getString(2) == settings.user && it.getBoolean(3))
                }
                // V1 SQL 내부 검사와 동일한 과거 배포 식별자만 차단한다. 타 도메인 V1/V2는 허용한다.
                val histories = mutableListOf<Pair<String, String>>()
                statement.executeQuery("""SELECT schemaname, tablename FROM pg_catalog.pg_tables
                    WHERE schemaname <> 'worldstudio' AND tablename IN ('world_studio_schema_history', 'flyway_schema_history')""").use {
                    while (it.next()) histories += it.getString(1) to it.getString(2)
                }
                for ((schema, table) in histories) {
                    fun quoted(value: String) = "\"" + value.replace("\"", "\"\"") + "\""
                    statement.executeQuery("""SELECT count(*) FROM ${quoted(schema)}.${quoted(table)}
                        WHERE success AND type='SQL' AND
                        ((version='1' AND script='V1__initial_world_schema.sql' AND checksum=943880700)
                        OR (version='2' AND script='V2__protect_world_revision.sql' AND checksum=-391778711))""").use {
                        check(it.next() && it.getInt(1) == 0)
                    }
                }
            }
            connection.rollback()
        }
        val flyway = Flyway.configure().dataSource(settings.url, settings.user, settings.password)
            .locations("classpath:db/migration/worldstudio")
            .schemas("worldstudio").defaultSchema("worldstudio").table("world_studio_schema_history")
            .cleanDisabled(true).baselineOnMigrate(false).load()
        val result = flyway.migrate()
        flyway.validate()
        check(flyway.info().pending().isEmpty())
        DriverManager.getConnection(settings.url, credentials).use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='worldstudio' AND tablename <> 'world_studio_schema_history'").use {
                    check(it.next() && it.getInt(1) == 12)
                }
            }
        }
        return result.migrationsExecuted
    }
}
