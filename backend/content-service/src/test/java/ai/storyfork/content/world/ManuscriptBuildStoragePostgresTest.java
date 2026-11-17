package ai.storyfork.content.world;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;
import static ai.storyfork.content.world.WorldStudioPostgresFixture.*;

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL", matches=".+")
class ManuscriptBuildStoragePostgresTest {
    @Test void inputResultsAndReservedPayloadCannotBeRewritten() throws Exception {
        try (var db = new WorldStudioPostgresFixture("independent")) {
            db.studio().migrate();
            try (var c = db.connect()) {
                c.setAutoCommit(false);
                var world=id(); var job=id(); var step=id(); var result=id();
                var hash="a".repeat(64);
                sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('"+world+"','"+id()+"')");
                sql(c,"INSERT INTO worldstudio.manuscript_build_job(id,work_id,world_id,owner_subject,request_key,request_hash,manifest,status) VALUES ('"+job+"','work-qa','"+world+"','"+id()+"','same-key','"+hash+"','{\"episodes\":[1,2]}','queued')");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_job SET manifest='{\"episodes\":[1,2,3]}' WHERE id='"+job+"'");
                sql(c,"INSERT INTO worldstudio.manuscript_build_result(id,job_id,kind,episode,content,content_hash) VALUES ('"+result+"','"+job+"','extraction',1,'{\"quote\":\"원문\"}','"+hash+"')");
                rejects(c,"23505","INSERT INTO worldstudio.manuscript_build_result(id,job_id,kind,episode,content,content_hash) VALUES ('"+id()+"','"+job+"','extraction',1,'{}','"+hash+"')");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_result SET content='{}' WHERE id='"+result+"'");
                rejects(c,"23514","DELETE FROM worldstudio.manuscript_build_result WHERE id='"+result+"'");
                sql(c,"INSERT INTO worldstudio.manuscript_build_load_step(id,job_id,sequence,request_payload,request_hash,status) VALUES ('"+step+"','"+job+"',1,'{\"replace\":false,\"key\":\"stable\"}','"+hash+"','prepared')");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_load_step SET request_payload='{\"replace\":false,\"key\":\"different\"}' WHERE id='"+step+"'");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_load_step SET status='applied' WHERE id='"+step+"'");
                sql(c,"UPDATE worldstudio.manuscript_build_load_step SET status='unknown' WHERE id='"+step+"'");
                sql(c,"UPDATE worldstudio.manuscript_build_load_step SET status='applied',receipt='{\"draftRevision\":1}' WHERE id='"+step+"'");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_load_step SET receipt='{\"draftRevision\":2}' WHERE id='"+step+"'");
                c.commit();
            }
            // New connection represents process-local state loss; no in-memory result is reused.
            try (var c=db.connect()) {
                assertEquals(java.util.List.of("1"),rows(c,"SELECT count(*) FROM worldstudio.manuscript_build_result"));
                assertEquals(java.util.List.of("stable"),rows(c,"SELECT request_payload->>'key' FROM worldstudio.manuscript_build_load_step"));
                assertEquals(java.util.List.of("1"),rows(c,"SELECT receipt->>'draftRevision' FROM worldstudio.manuscript_build_load_step"));
            }
        }
    }
}
