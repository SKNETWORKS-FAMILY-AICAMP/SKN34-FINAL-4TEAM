package ai.storyfork.content.world;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.util.List;
import static ai.storyfork.content.world.WorldStudioPostgresFixture.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL", matches=".+")
class InitialWorldStoragePostgresTest {
    @Test void upgradePreservesSnapshotsAndEnforcesReviewAndReservationOwnership() throws Exception {
        try(var db=new WorldStudioPostgresFixture("independent")) {
            org.flywaydb.core.Flyway.configure().configuration(db.studio().getConfiguration()).target("2").load().migrate();
            String w=id(), other=id(), a=id(), candidate=id(), decision=id(), app=id(), generated=id();
            try(var c=db.connect()) {
                sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('"+w+"','"+id()+"'),('"+other+"','"+id()+"')");
                sql(c,"INSERT INTO worldstudio.world_draft(world_id,name,description) VALUES ('"+w+"','홍길동전','원문 보존')");
            }
            assertEquals(1,db.studio().migrate().migrationsExecuted);
            db.studio().validate();
            assertEquals(0,db.studio().migrate().migrationsExecuted);
            try(var c=db.connect()) {
                c.setAutoCommit(false);
                String snapshot="{\"sources\":[{\"text\":\"홍😀길동\"}]}";
                sql(c,"INSERT INTO worldstudio.initial_analysis(id,world_id,request_key,request_hash,draft_revision,relationship_version,input_snapshot,execution_token,deadline) VALUES ('"+a+"','"+w+"','analysis-1',repeat('a',64),2,3,'"+snapshot+"','"+id()+"',now()+interval '90 seconds')");
                rejects(c,"23505","INSERT INTO worldstudio.initial_analysis SELECT '"+id()+"',world_id,request_key,request_hash,draft_revision,relationship_version,current_revision_id,input_snapshot,execution_token,deadline,execution_status,output,created_at,lock_version FROM worldstudio.initial_analysis");
                rejects(c,"23514","UPDATE worldstudio.initial_analysis SET input_snapshot='{}' WHERE id='"+a+"'");
                rejects(c,"23514","INSERT INTO worldstudio.initial_analysis(id,world_id,request_key,request_hash,draft_revision,relationship_version,input_snapshot,execution_token,deadline) VALUES ('"+id()+"','"+w+"','not/a/key',repeat('a',64),2,3,'{}','"+id()+"',now()+interval '90 seconds')");
                sql(c,"UPDATE worldstudio.initial_analysis SET execution_status='completed',output='{}' WHERE id='"+a+"'");
                String ai="{\"type\":\"fact\",\"provenance\":\"ai_extraction\",\"evidence\":[{\"sourceId\":\"test\"}]}";
                sql(c,"INSERT INTO worldstudio.initial_candidate(id,world_id,analysis_id,local_ref,content) VALUES ('"+candidate+"','"+w+"','"+a+"','fact-1','"+ai+"')");
                rejects(c,"23503","INSERT INTO worldstudio.initial_candidate(id,world_id,analysis_id,local_ref,content) VALUES ('"+id()+"','"+other+"','"+a+"','wrong-world','"+ai+"')");
                rejects(c,"23514","UPDATE worldstudio.initial_candidate SET content='{}' WHERE id='"+candidate+"'");
                sql(c,"INSERT INTO worldstudio.initial_decision(id,world_id,analysis_id,candidate_id,sequence,action,state,actor_id,content) VALUES ('"+decision+"','"+w+"','"+a+"','"+candidate+"',1,'approve','approved','"+id()+"','"+ai+"')");
                rejects(c,"23514","INSERT INTO worldstudio.initial_decision(id,world_id,analysis_id,candidate_id,sequence,action,state,actor_id,content) VALUES ('"+id()+"','"+w+"','"+a+"','"+candidate+"',2,'edit','pending','"+id()+"','"+ai+"')");
                rejects(c,"23514","DELETE FROM worldstudio.initial_decision WHERE id='"+decision+"'");
                sql(c,"INSERT INTO worldstudio.initial_application(id,world_id,analysis_id,request_key,request_hash,base_draft_revision,relationship_version,addition_payload) VALUES ('"+app+"','"+w+"','"+a+"','apply-1',repeat('b',64),2,3,'{\"replace\":false}')");
                String item="INSERT INTO worldstudio.initial_application_item(id,world_id,analysis_id,application_id,candidate_id,decision_sequence,generated_id,generated_kind) VALUES ('";
                sql(c,item+id()+"','"+w+"','"+a+"','"+app+"','"+candidate+"',1,'"+generated+"','card')");
                rejects(c,"23505",item+id()+"','"+w+"','"+a+"','"+app+"','"+candidate+"',1,'"+id()+"','card')");
                rejects(c,"23514","UPDATE worldstudio.initial_application_item SET generated_id='"+id()+"'");
                rejects(c,"23514","UPDATE worldstudio.initial_application_item SET active=false");
                rejects(c,"23514","UPDATE worldstudio.initial_application SET addition_payload='{}'");
                rejects(c,"23514","UPDATE worldstudio.initial_application SET status='applied',result_draft_revision=8");
                sql(c,"UPDATE worldstudio.initial_application SET status='unknown'");
                c.commit();
            }
            try(var c=db.connect()) {
                assertEquals(List.of(generated),rows(c,"SELECT generated_id FROM worldstudio.initial_application_item"));
                assertEquals(List.of("unknown"),rows(c,"SELECT status FROM worldstudio.initial_application"));
                assertEquals(List.of("홍😀길동"),rows(c,"SELECT input_snapshot#>>'{sources,0,text}' FROM worldstudio.initial_analysis"));
                assertEquals(List.of("원문 보존"),rows(c,"SELECT description FROM worldstudio.world_draft WHERE world_id='"+w+"'"));
                c.setAutoCommit(false);
                String app2=id();
                String second="INSERT INTO worldstudio.initial_application(id,world_id,analysis_id,request_key,request_hash,base_draft_revision,relationship_version,addition_payload) VALUES ('"+app2+"','"+w+"','"+a+"','apply-2',repeat('c',64),3,4,'{\"replace\":false}')";
                rejects(c,"23505",second);
                var completed=c.setSavepoint();
                sql(c,"UPDATE worldstudio.initial_application SET status='applied',result_draft_revision=3");
                rejects(c,"23514","UPDATE worldstudio.initial_application SET status='unknown',result_draft_revision=NULL");
                sql(c,second);
                rejects(c,"23505","INSERT INTO worldstudio.initial_application_item(id,world_id,analysis_id,application_id,candidate_id,decision_sequence,generated_id,generated_kind) VALUES ('"+id()+"','"+w+"','"+a+"','"+app2+"','"+candidate+"',1,'"+id()+"','card')");
                c.rollback(completed);
                sql(c,"UPDATE worldstudio.initial_application SET status='failed'");
                sql(c,"UPDATE worldstudio.initial_application_item SET active=false");
                c.commit();
                assertEquals(List.of(generated),rows(c,"SELECT generated_id FROM worldstudio.initial_application_item"));
            }
        }
    }
}
