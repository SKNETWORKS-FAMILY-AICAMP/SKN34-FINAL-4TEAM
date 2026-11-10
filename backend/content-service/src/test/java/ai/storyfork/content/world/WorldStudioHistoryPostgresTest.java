package ai.storyfork.content.world;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import java.nio.file.*;
import java.sql.SQLException;
import java.util.List;
import static ai.storyfork.content.world.WorldStudioPostgresFixture.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL", matches=".+")
class WorldStudioHistoryPostgresTest {
    @TempDir Path scripts;
    @Test void acceptsOtherDomainsAppliedV1V2EvenWithTheSameHistoryAndScriptNames() throws Exception {
        Files.writeString(scripts.resolve("V1__initial_world_schema.sql"),"CREATE TABLE normal_domain_data(id int PRIMARY KEY, body text); INSERT INTO normal_domain_data VALUES (1,'keep');");
        Files.writeString(scripts.resolve("V2__protect_world_revision.sql"),"INSERT INTO normal_domain_data VALUES (2,'keep too');");
        try(var db=new WorldStudioPostgresFixture("independent")) {
            var foreign=Flyway.configure().dataSource(db.url,System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD"))
                .schemas("foreign_domain").defaultSchema("foreign_domain").table("world_studio_schema_history")
                .locations("filesystem:"+scripts.toAbsolutePath()).load();
            assertEquals(2,foreign.migrate().migrationsExecuted);
            List<String> before;
            try(var c=db.connect()) { before=rows(c,"SELECT to_jsonb(h)::text FROM foreign_domain.world_studio_schema_history h ORDER BY installed_rank"); }
            assertEquals(4,db.studio().migrate().migrationsExecuted);
            db.studio().validate(); assertEquals(0,db.studio().migrate().migrationsExecuted); foreign.validate();
            try(var c=db.connect()) {
                assertEquals(before,rows(c,"SELECT to_jsonb(h)::text FROM foreign_domain.world_studio_schema_history h ORDER BY installed_rank"));
                assertEquals(List.of("keep","keep too"),rows(c,"SELECT body FROM foreign_domain.normal_domain_data ORDER BY id"));
            }
        }
    }
    // Reproduce archived applied SQL identities, without executing the old Content-dependent SQL.
    @ParameterizedTest
    @CsvSource({"world_studio_schema_history,1,V1__initial_world_schema.sql,943880700", "flyway_schema_history,2,V2__protect_world_revision.sql,-391778711"})
    void refusesOnlySuccessfullyAppliedArchivedWorldStudioIdentity(String table,String version,String script,int checksum) throws Exception {
        try(var db=new WorldStudioPostgresFixture("independent")) {
            try(var c=db.connect()) {
                sql(c,"CREATE TABLE public."+table+"(version text,type text,script text,checksum integer,success boolean)");
                sql(c,"INSERT INTO public."+table+" VALUES ('"+version+"','SQL','"+script+"',"+checksum+",true)");
            }
            var failure=assertThrows(FlywayException.class,()->db.studio().migrate());
            Throwable cause=failure;
            while(cause!=null && !(cause instanceof SQLException)) cause=cause.getCause();
            assertNotNull(cause,"Rejection must originate from the explicit migration identity guard");
            assertEquals("23514",((SQLException)cause).getSQLState());
            try(var c=db.connect()) {
                assertEquals(List.of(script),rows(c,"SELECT script FROM public."+table));
                assertEquals(List.of("0"),rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename <> 'world_studio_schema_history'"));
            }
        }
    }
    @Test void failedOrIncompleteOrBaselineRecordsAreNotAppliedOldMigrations() throws Exception {
        try(var db=new WorldStudioPostgresFixture("independent")) {
            try(var c=db.connect()) {
                sql(c,"CREATE TABLE public.world_studio_schema_history(version text,type text,script text,checksum integer,success boolean)");
                sql(c,"INSERT INTO public.world_studio_schema_history VALUES ('1','SQL','V1__initial_world_schema.sql',943880700,false),('1','BASELINE','V1__initial_world_schema.sql',943880700,true),('1','SQL','V1__initial_world_schema.sql',NULL,true),('1','SQL','V1__other_domain.sql',943880700,true)");
            }
            assertEquals(4,db.studio().migrate().migrationsExecuted);
            try(var c=db.connect()) { assertEquals(List.of("4"),rows(c,"SELECT count(*) FROM public.world_studio_schema_history")); }
        }
    }
    @Test void refusesNonemptyUnrecognizedSchemaWithoutBaseline() throws Exception {
        try(var db=new WorldStudioPostgresFixture("independent")) {
            try(var c=db.connect()) {
                sql(c,"CREATE SCHEMA worldstudio"); sql(c,"CREATE TABLE worldstudio.unrecognized(id int PRIMARY KEY)");
                sql(c,"INSERT INTO worldstudio.unrecognized VALUES (42)");
            }
            assertThrows(FlywayException.class,()->db.studio().migrate());
            try(var c=db.connect()) {
                assertEquals(List.of("42"),rows(c,"SELECT id::text FROM worldstudio.unrecognized"));
                assertEquals(List.of("0"),rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename='world'"));
            }
        }
    }
}
