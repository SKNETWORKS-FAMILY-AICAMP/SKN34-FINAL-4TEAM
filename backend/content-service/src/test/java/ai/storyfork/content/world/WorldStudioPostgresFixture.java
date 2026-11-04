package ai.storyfork.content.world;

import org.flywaydb.core.Flyway;
import java.sql.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Only explicitly disposable PostgreSQL instances; never a configured application DB. */
final class WorldStudioPostgresFixture implements AutoCloseable {
    private final String base = System.getenv("TEST_WORLDSTUDIO_DATABASE_URL");
    private final String user = System.getenv("TEST_WORLDSTUDIO_DATABASE_USER");
    private final String password = System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD");
    private final String database;
    final String url;

    WorldStudioPostgresFixture(String mode) throws SQLException {
        assertEquals("true", System.getenv("TEST_WORLDSTUDIO_DISPOSABLE"));
        assertTrue(base.startsWith("jdbc:postgresql://"));
        database = "ws_" + mode + "_" + UUID.randomUUID().toString().replace("-", "");
        assertTrue(database.matches("ws_(independent|coexist)_[a-f0-9]{32}"));
        url = base.substring(0, base.lastIndexOf('/') + 1) + database;
        try (var c = DriverManager.getConnection(base, user, password); var s = c.createStatement()) {
            s.execute("CREATE DATABASE " + database);
        }
    }
    Connection connect() throws SQLException { return DriverManager.getConnection(url, user, password); }
    Flyway studio() {
        return Flyway.configure().dataSource(url, user, password)
            .locations("classpath:db/migration/worldstudio").schemas("worldstudio")
            .defaultSchema("worldstudio").table("world_studio_schema_history").load();
    }
    static String id() { return UUID.randomUUID().toString(); }
    static void sql(Connection c, String sql) throws SQLException {
        try(var s = c.createStatement()) { s.execute(sql); }
    }
    static List<String> rows(Connection c, String sql) throws SQLException {
        var result = new ArrayList<String>();
        try(var s = c.createStatement(); var r = s.executeQuery(sql)) {
            while(r.next()) result.add(r.getString(1));
        }
        return result;
    }
    static void rejects(Connection c, String state, String sql) throws SQLException {
        var point = c.setSavepoint();
        var failure = assertThrows(SQLException.class, () -> sql(c, sql));
        assertEquals(state, failure.getSQLState(), failure.getMessage());
        c.rollback(point);
    }
    @Override public void close() throws SQLException {
        // Name is generated above, never provided by env or application input.
        try(var c = DriverManager.getConnection(base,user,password); var s = c.createStatement()) {
            s.execute("DROP DATABASE " + database + " WITH (FORCE)");
        }
    }
}
