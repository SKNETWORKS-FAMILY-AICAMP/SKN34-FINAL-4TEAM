package ai.storyfork.content.world;

import ai.storyfork.content._common.config.ContentPersistenceConfig;
import java.nio.file.Path;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.sql.Connection;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DISPOSABLE", matches="true")
class WorldStudioMigrationPostgresTest {
    // Content 시작 시 WorldStudioConfig가 쓰는 것과 같은 Flyway 설정(fixture.studio())을 검증한다.
    @Test void independentCommandAppliesV1AndRerunsWithoutChanges() throws Exception {
        try (var db = new WorldStudioPostgresFixture("independent")) {
            if ("true".equals(System.getenv("TEST_WORLDSTUDIO_PASSWORD_AUTH"))) {
                var failure = assertThrows(java.sql.SQLException.class, () -> {
                    try (var ignored = java.sql.DriverManager.getConnection(db.url,
                            System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),
                            System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD") + "-incorrect")) {
                        fail("Password-authenticated CI database must reject an incorrect password");
                    }
                });
                assertEquals("28P01", failure.getSQLState());
            }
            assertEquals(5, db.studio().migrate().migrationsExecuted);
            assertEquals(0, db.studio().migrate().migrationsExecuted);
            db.studio().validate();
            try (var c = db.connect()) {
                assertEquals("18", WorldStudioPostgresFixture.rows(c,
                    "SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename <> 'world_studio_schema_history'").getFirst());
                assertEquals(java.util.List.of("1", "2", "3", "4", "5"), WorldStudioPostgresFixture.rows(c,
                    "SELECT version FROM worldstudio.world_studio_schema_history WHERE success AND type='SQL' ORDER BY installed_rank"));
                assertEquals("0", WorldStudioPostgresFixture.rows(c,
                    "SELECT count(*) FROM pg_tables WHERE schemaname='public'").getFirst());
            }
        }
    }

    @Test void commandPreservesAuthContentDataAndHistories() throws Exception {
        try (var db = new WorldStudioPostgresFixture("coexist")) {
            var user = System.getenv("TEST_WORLDSTUDIO_DATABASE_USER");
            var password = System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD");
            var auth = Flyway.configure().dataSource(db.url,user,password)
                .locations("filesystem:" + Path.of("../core-api/src/main/resources/db/migration/auth").toAbsolutePath())
                .table("flyway_schema_history").load();
            auth.migrate();
            var content = Flyway.configure().dataSource(db.url,user,password)
                .locations(ContentPersistenceConfig.Companion.getMIGRATION_LOCATIONS())
                .table("content_schema_history").baselineOnMigrate(true).baselineVersion("0").load();
            content.migrate();
            try (var c = db.connect()) {
                var before = publicRows(c);
                assertEquals(5, db.studio().migrate().migrationsExecuted);
                assertEquals(0, db.studio().migrate().migrationsExecuted);
                assertEquals(before, publicRows(c));
            }
            auth.validate(); content.validate();
            assertEquals(0, auth.migrate().migrationsExecuted);
            assertEquals(0, content.migrate().migrationsExecuted);
        }
    }

    @Test void knownLegacyHistoryBlocksBeforeCreatingStudioSchema() throws Exception {
        try (var db = new WorldStudioPostgresFixture("independent"); var c = db.connect()) {
            WorldStudioPostgresFixture.sql(c, "CREATE TABLE public.flyway_schema_history(version text, script text, checksum integer, type text, success boolean)");
            WorldStudioPostgresFixture.sql(c, "INSERT INTO public.flyway_schema_history VALUES ('1','V1__initial_world_schema.sql',943880700,'SQL',true)");
            assertThrows(org.flywaydb.core.api.FlywayException.class, () -> db.studio().migrate());
            // V1 SQL의 과거 이력 검사가 실패시키므로 studio 테이블은 하나도 생기지 않는다(빈 schema/이력은 Flyway가 남길 수 있다).
            assertEquals("0", WorldStudioPostgresFixture.rows(c,
                "SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename <> 'world_studio_schema_history'").getFirst());
        }
    }

    private Map<String, java.util.List<String>> publicRows(Connection c) throws Exception {
        var result = new java.util.TreeMap<String, java.util.List<String>>();
        for (var table : WorldStudioPostgresFixture.rows(c, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")) {
            assertTrue(table.matches("[a-z_0-9]+"));
            result.put(table, WorldStudioPostgresFixture.rows(c, "SELECT to_jsonb(t)::text FROM public.\"" + table + "\" t ORDER BY to_jsonb(t)::text"));
        }
        return result;
    }
}
