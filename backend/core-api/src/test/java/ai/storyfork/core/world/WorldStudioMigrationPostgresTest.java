package ai.storyfork.core.world;

import ai.storyfork.core.world.migration.WorldStudioMigration;
import ai.storyfork.core.world.migration.WorldStudioMigrationProperties;
import ai.storyfork.core.content.repository.V5__ImportLegacyContent;
import tools.jackson.databind.json.JsonMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.sql.Connection;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DISPOSABLE", matches="true")
class WorldStudioMigrationPostgresTest {
    private WorldStudioMigrationProperties settings(WorldStudioPostgresFixture db) {
        return WorldStudioMigrationProperties.Companion.from(Map.of(
            "WORLDSTUDIO_MIGRATION_ENVIRONMENT", "development",
            "CORE_DATABASE_URL", db.url,
            "CORE_DATABASE_USER", System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),
            // CI PostgreSQL trust 인증 전용. 실제 개발 DB 자격증명은 사용하지 않는다.
            "CORE_DATABASE_PASSWORD", "ci-only",
            "WORLDSTUDIO_EXPECTED_DATABASE_URL", db.url,
            "WORLDSTUDIO_EXPECTED_DATABASE_USER", System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),
            "WORLDSTUDIO_BACKUP_RESTORE_REFERENCE", "disposable-ci-database"));
    }

    @Test void independentCommandAppliesV1AndRerunsWithoutChanges() throws Exception {
        try (var db = new WorldStudioPostgresFixture("independent")) {
            assertEquals(1, WorldStudioMigration.INSTANCE.migrate(settings(db)));
            assertEquals(0, WorldStudioMigration.INSTANCE.migrate(settings(db)));
            db.studio().validate();
            try (var c = db.connect()) {
                assertEquals("12", WorldStudioPostgresFixture.rows(c,
                    "SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename <> 'world_studio_schema_history'").getFirst());
                assertEquals("1", WorldStudioPostgresFixture.rows(c,
                    "SELECT version FROM worldstudio.world_studio_schema_history WHERE success AND type='SQL'").getFirst());
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
                .locations("classpath:db/migration/auth").table("flyway_schema_history").load();
            auth.migrate();
            var content = Flyway.configure().dataSource(db.url,user,password).locations("classpath:db/content")
                .javaMigrations(new V5__ImportLegacyContent(JsonMapper.builder().findAndAddModules().build()))
                .table("content_schema_history").baselineOnMigrate(true).baselineVersion("0").load();
            content.migrate();
            try (var c = db.connect()) {
                var before = publicRows(c);
                assertEquals(1, WorldStudioMigration.INSTANCE.migrate(settings(db)));
                assertEquals(0, WorldStudioMigration.INSTANCE.migrate(settings(db)));
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
            assertThrows(IllegalStateException.class, () -> WorldStudioMigration.INSTANCE.migrate(settings(db)));
            assertEquals("0", WorldStudioPostgresFixture.rows(c,
                "SELECT count(*) FROM pg_namespace WHERE nspname='worldstudio'").getFirst());
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
