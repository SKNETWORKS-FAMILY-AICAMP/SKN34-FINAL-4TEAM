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
                var hash="a".repeat(64); var owner=id();
                sql(c,"CREATE TABLE work(id varchar(36) PRIMARY KEY)");
                try(var stream=getClass().getResourceAsStream("/db/migration/preprocessing/V41__manuscript_preprocessing_job.sql")) {
                    sql(c,new String(java.util.Objects.requireNonNull(stream).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
                }
                sql(c,"INSERT INTO work VALUES ('work-qa')");
                sql(c,"INSERT INTO preprocessing_job(id,work_id,world_id,member_id,status,total,created_at) VALUES ('"+job+"','work-qa','"+world+"','"+owner+"','queued',2,now())");
                sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('"+world+"','"+owner+"')");
                sql(c,"INSERT INTO worldstudio.manuscript_build_job(id,work_id,world_id,owner_subject,request_key,request_hash,manifest,status) VALUES ('"+job+"','work-qa','"+world+"','"+owner+"','same-key','"+hash+"','{\"episodes\":[{\"number\":1},{\"number\":2}]}','queued')");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_job SET manifest='{\"episodes\":[1,2,3]}' WHERE id='"+job+"'");
                sql(c,"UPDATE worldstudio.manuscript_build_job SET status='running' WHERE id='"+job+"'");
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

    /** 발행 회차 업데이트 작업(V16·V43): 완료된 최초 구축 옆에 접수되고, 기준 초안은 claim 때 쓰며, 불변 입력은 그대로 지킨다. */
    @Test void updateJobsCoexistWithACompletedInitialJobAndFixTheirBasisAtClaim() throws Exception {
        try (var db = new WorldStudioPostgresFixture("independent")) {
            db.studio().migrate();
            try (var c = db.connect()) {
                c.setAutoCommit(false);
                var world=id(); var update=id(); var owner=id(); var hash="a".repeat(64);
                sql(c,"CREATE TABLE work(id varchar(36) PRIMARY KEY)");
                for(var script : new String[]{"V41__manuscript_preprocessing_job.sql","V43__preprocessing_job_kind.sql"}) {
                    try(var stream=getClass().getResourceAsStream("/db/migration/preprocessing/"+script)) {
                        sql(c,new String(java.util.Objects.requireNonNull(stream).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
                    }
                }
                sql(c,"INSERT INTO work VALUES ('work-qa')");
                sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('"+world+"','"+owner+"')");
                var insert="INSERT INTO preprocessing_job(id,work_id,world_id,member_id,status,total,created_at,kind) VALUES ('";
                sql(c,insert+id()+"','work-qa','"+world+"','"+owner+"','completed',2,now(),'initial')");
                sql(c,insert+update+"','work-qa','"+world+"','"+owner+"','queued',1,now(),'update')");
                // 같은 작품에서 진행 중 update와 진행 중·완료 initial은 하나씩이고 실패한 작업은 여럿 남을 수 있다.
                rejects(c,"23505",insert+id()+"','work-qa','"+world+"','"+owner+"','running',1,now(),'update')");
                rejects(c,"23505",insert+id()+"','work-qa','"+world+"','"+owner+"','queued',1,now(),'initial')");
                rejects(c,"23514",insert+id()+"','work-qa','"+world+"','"+owner+"','failed',1,now(),'other')");
                sql(c,insert+id()+"','work-qa','"+world+"','"+owner+"','failed',1,now(),'update')");
                sql(c,"INSERT INTO worldstudio.manuscript_build_job(id,work_id,world_id,owner_subject,request_key,request_hash,manifest,status,kind) VALUES ('"+update+"','work-qa','"+world+"','"+owner+"','publish:ev','"+hash+"','{\"episodes\":[{\"number\":3}]}','queued','update')");
                rejects(c,"23514","INSERT INTO worldstudio.manuscript_build_job(id,work_id,world_id,owner_subject,request_key,request_hash,manifest,status,kind) VALUES ('"+id()+"','work-qa','"+world+"','"+owner+"','other-key','"+hash+"','{\"episodes\":[{\"number\":3}]}','queued','other')");
                // 불변 입력(manifest)은 update 작업도 바꿀 수 없고 기준 초안(basis)만 실행권을 받은 뒤 정할 수 있다.
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_job SET manifest='{\"episodes\":[{\"number\":4}]}' WHERE id='"+update+"'");
                sql(c,"UPDATE worldstudio.manuscript_build_job SET status='running' WHERE id='"+update+"'");
                sql(c,"UPDATE worldstudio.manuscript_build_job SET basis='{\"draftRevision\":5}' WHERE id='"+update+"'");
                rejects(c,"23514","UPDATE worldstudio.manuscript_build_job SET basis='[1]' WHERE id='"+update+"'");
                assertEquals(java.util.List.of("update|running"),rows(c,"SELECT kind||'|'||status FROM preprocessing_job WHERE id='"+update+"'"));
                assertEquals(java.util.List.of("5"),rows(c,"SELECT basis->>'draftRevision' FROM worldstudio.manuscript_build_job WHERE id='"+update+"'"));
                c.commit();
            }
        }
    }
}
