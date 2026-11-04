package ai.storyfork.core.world;

import org.flywaydb.core.api.Location;
import org.flywaydb.core.internal.resolver.ChecksumCalculator;
import org.flywaydb.core.internal.resource.filesystem.FileSystemResource;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class WorldStudioMigrationIdentityTest {
    @Test void archivedSqlHasTheExactFlywayChecksumsUsedByTheIdentityGuard() {
        var archive=Path.of("../../docs/archive/worldstudio-content-extension").toAbsolutePath();
        var location=new Location("filesystem:"+archive);
        assertEquals(943880700,ChecksumCalculator.calculate(new FileSystemResource(location,archive.resolve("V1__initial_world_schema.sql.txt").toString(),StandardCharsets.UTF_8,false)));
        assertEquals(-391778711,ChecksumCalculator.calculate(new FileSystemResource(location,archive.resolve("V2__protect_world_revision.sql.txt").toString(),StandardCharsets.UTF_8,false)));
    }
}
