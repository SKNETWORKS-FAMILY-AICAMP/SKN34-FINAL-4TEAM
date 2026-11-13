package ai.storyfork.content.world;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.sql.*;
import java.util.*;
import static ai.storyfork.content.world.WorldStudioPostgresFixture.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL", matches=".+")
class WorldStudioFlywayPostgresTest {
    @Test void independentInitialSchemaPreservesSnapshotsAndRejectsInvalidCommits() throws Exception {
        try(var db = new WorldStudioPostgresFixture("independent")) {
            try(var c=db.connect()) {
                assertEquals(List.of("0"),rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='public'"));
            }
            var flyway=db.studio();
            assertEquals(7,flyway.migrate().migrationsExecuted);
            flyway.validate();
            assertEquals(0,flyway.migrate().migrationsExecuted);
            String w=id(), owner=id(), rev=id(), card=id(), other=id(), v1=id(), v2=id(), v3=id();
            String r=id(), rv=id();
            try(var c=db.connect()) {
                assertEquals(List.of("18"),rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='worldstudio' AND tablename<>'world_studio_schema_history'"));
                assertEquals(List.of("0"),rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='public'"));
                c.setAutoCommit(false);
                sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('"+w+"','"+owner+"')");
                sql(c,"INSERT INTO worldstudio.world_draft(world_id,name,description) VALUES ('"+w+"','독립 세계','본문 | 원문 보존')");
                sql(c,"INSERT INTO worldstudio.setting_card(id,world_id) VALUES ('"+card+"','"+w+"'),('"+other+"','"+w+"')");
                sql(c,"INSERT INTO worldstudio.setting_card_draft(card_id,world_id,title,body,card_type,area_code,tags,aliases) VALUES ('"+card+"','"+w+"','홍길동','  첫 줄  '||chr(10)||'다음 줄','character','basic',ARRAY['태그2','태그1'],ARRAY['길동','길동'])");
                assertEquals(List.of("private"),rows(c,"SELECT visibility FROM worldstudio.setting_card_draft WHERE card_id='"+card+"'"));
                sql(c,version(v1,card,w,1,"private",null));
                String ov=id();
                sql(c,version(ov,other,w,1,"private",null));
                String[] types={"character","location","organization","ability","object","rule","event","other"};
                String[] areas={"basic","space","history","society","culture","special","conflict"};
                for(int i=0;i<types.length;i++) {
                    String cid=id(); sql(c,"INSERT INTO worldstudio.setting_card(id,world_id) VALUES ('"+cid+"','"+w+"')");
                    sql(c,"INSERT INTO worldstudio.setting_card_version(id,card_id,world_id,version_no,title,body,card_type,area_code) VALUES ('"+id()+"','"+cid+"','"+w+"',1,'선택 항목','원문','"+types[i]+"','"+areas[i%7]+"')");
                }
                sql(c,"INSERT INTO worldstudio.relationship(id,world_id) VALUES ('"+r+"','"+w+"')");
                sql(c,"INSERT INTO worldstudio.relationship_draft(relation_id,world_id) VALUES ('"+r+"','"+w+"')");
                sql(c,"INSERT INTO worldstudio.relationship_version(id,relation_id,world_id,version_no,source_card_id,target_card_id,category,body,direction,polarity) VALUES ('"+rv+"','"+r+"','"+w+"',1,'"+card+"','"+other+"','emotional','신뢰하면서도 경계','directed','asserted')");
                String structural=id(), sv=id();
                sql(c,"INSERT INTO worldstudio.relationship(id,world_id) VALUES ('"+structural+"','"+w+"')");
                sql(c,"INSERT INTO worldstudio.relationship_version(id,relation_id,world_id,version_no,source_card_id,target_card_id,category,body,direction) VALUES ('"+sv+"','"+structural+"','"+w+"',1,'"+other+"','"+card+"','structural','부자 관계','directed')");
                sql(c,revision(rev,w,1,null));
                manifest(c,rev,w,card,v1); manifest(c,rev,w,other,ov);
                sql(c,"INSERT INTO worldstudio.world_revision_relationship(world_id,revision_id,relation_id,version_id) VALUES ('"+w+"','"+rev+"','"+r+"','"+rv+"'),('"+w+"','"+rev+"','"+structural+"','"+sv+"')");
                seal(c,rev);
                sql(c,"UPDATE worldstudio.world SET current_revision_id='"+rev+"' WHERE id='"+w+"'");
                sql(c,"INSERT INTO worldstudio.world_save_request(world_id,request_key,request_hash,revision_id) VALUES ('"+w+"','retry-1','hash-1','"+rev+"')");
                c.commit();

                try(var update=c.prepareStatement("UPDATE worldstudio.world_draft SET name=?,draft_revision=draft_revision+1 WHERE world_id=?::uuid AND draft_revision=?")) {
                    update.setString(1,"검증된 편집본"); update.setString(2,w); update.setLong(3,0);
                    assertEquals(1,update.executeUpdate());
                    update.setString(1,"오래된 편집본");
                    assertEquals(0,update.executeUpdate());
                }
                assertEquals(List.of("검증된 편집본"),rows(c,"SELECT name FROM worldstudio.world_draft WHERE world_id='"+w+"'"));
                c.rollback();

                // Commit-time sealing failure must roll back versions and draft edits together.
                sql(c,"UPDATE worldstudio.world_draft SET name='失敗で残してはいけない' WHERE world_id='"+w+"'");
                sql(c,version(id(),card,w,2,"public",null));
                sql(c,revision(id(),w,2,null));
                var failed=assertThrows(SQLException.class,c::commit);
                assertEquals("23514",failed.getSQLState()); c.rollback();
                assertEquals(List.of("독립 세계"),rows(c,"SELECT name FROM worldstudio.world_draft WHERE world_id='"+w+"'"));
                assertEquals(List.of("1"),rows(c,"SELECT count(*) FROM worldstudio.setting_card_version WHERE card_id='"+card+"'"));

                rejects(c,"23514","UPDATE worldstudio.setting_card_version SET body='overwrite' WHERE id='"+v1+"'");
                rejects(c,"23514","DELETE FROM worldstudio.setting_card_version WHERE id='"+v1+"'");
                rejects(c,"23514","DELETE FROM worldstudio.world_revision_card WHERE revision_id='"+rev+"'");
                rejects(c,"23514","UPDATE worldstudio.world_revision_card SET version_id='"+v1+"' WHERE revision_id='"+rev+"'");
                rejects(c,"23514","INSERT INTO worldstudio.world_revision_card(world_id,revision_id,card_id,version_id) VALUES ('"+w+"','"+rev+"','"+card+"','"+v1+"')");
                rejects(c,"23514","UPDATE worldstudio.world_revision SET name='overwrite' WHERE id='"+rev+"'");
                rejects(c,"23514","UPDATE worldstudio.world_revision SET sealed=false WHERE id='"+rev+"'");
                rejects(c,"23514","DELETE FROM worldstudio.world_revision WHERE id='"+rev+"'");
                rejects(c,"23514","UPDATE worldstudio.relationship_version SET body='overwrite' WHERE id='"+rv+"'");
                rejects(c,"23514","DELETE FROM worldstudio.relationship_version WHERE id='"+rv+"'");
                rejects(c,"23514","UPDATE worldstudio.world_save_request SET request_hash='different' WHERE world_id='"+w+"'");
                rejects(c,"23505","INSERT INTO worldstudio.world_save_request(world_id,request_key,request_hash,revision_id) VALUES ('"+w+"','retry-1','different','"+rev+"')");
                assertEquals(List.of("hash-1:"+rev),rows(c,"SELECT request_hash||':'||revision_id FROM worldstudio.world_save_request WHERE world_id='"+w+"' AND request_key='retry-1'"));
                rejects(c,"23514","UPDATE worldstudio.setting_card_draft SET card_type='claim' WHERE card_id='"+card+"'");
                rejects(c,"23514","UPDATE worldstudio.setting_card_draft SET area_code='unknown' WHERE card_id='"+card+"'");
                rejects(c,"23514","UPDATE worldstudio.setting_card_draft SET visibility='published' WHERE card_id='"+card+"'");
                String foreignWorld=id(), foreignCard=id();
                sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('"+foreignWorld+"','"+id()+"')");
                sql(c,"INSERT INTO worldstudio.world_draft(world_id) VALUES ('"+foreignWorld+"')");
                sql(c,"INSERT INTO worldstudio.setting_card(id,world_id) VALUES ('"+foreignCard+"','"+foreignWorld+"')");
                rejects(c,"23503","UPDATE worldstudio.relationship_draft SET source_card_id='"+foreignCard+"' WHERE relation_id='"+r+"'");
                rejects(c,"23503",version(id(),foreignCard,w,1,"private",null));
                rejects(c,"23503","UPDATE worldstudio.world SET current_revision_id='"+rev+"' WHERE id='"+foreignWorld+"'");
                rejects(c,"23503","UPDATE worldstudio.world_draft SET base_world_revision_id='"+rev+"' WHERE world_id='"+foreignWorld+"'");
                // Endpoint must be present and active in the exact sealed revision.
                String incomplete=id(); sql(c,revision(incomplete,w,2,null)); manifest(c,incomplete,w,card,v1);
                rejects(c,"23503","INSERT INTO worldstudio.world_revision_card(world_id,revision_id,card_id,version_id) VALUES ('"+w+"','"+incomplete+"','"+other+"','"+v1+"')");
                sql(c,"INSERT INTO worldstudio.world_revision_relationship(world_id,revision_id,relation_id,version_id) VALUES ('"+w+"','"+incomplete+"','"+r+"','"+rv+"')");
                rejects(c,"23514","UPDATE worldstudio.world_revision SET sealed=true WHERE id='"+incomplete+"'");
                String removed=id();
                sql(c,"INSERT INTO worldstudio.setting_card_version(id,card_id,world_id,version_no,title,body,card_type,area_code,lifecycle) VALUES ('"+removed+"','"+other+"','"+w+"',2,'제거된 카드','원문','character','basic','removed')");
                manifest(c,incomplete,w,other,removed);
                rejects(c,"23514","UPDATE worldstudio.world_revision SET sealed=true WHERE id='"+incomplete+"'");
                c.rollback();

                // Privacy is a version snapshot: restore V1 by making a new V3, never overwriting V2.
                sql(c,version(v2,card,w,2,"public",null));
                String rev2=id(); sql(c,revision(rev2,w,2,null));manifest(c,rev2,w,card,v2);seal(c,rev2);c.commit();
                sql(c,"INSERT INTO worldstudio.setting_card_version(id,card_id,world_id,version_no,title,body,card_type,area_code,classification,semantic_metadata,lifecycle,aliases,tags,visibility,restored_from_version_id) SELECT '"+v3+"',card_id,world_id,3,title,body,card_type,area_code,classification,semantic_metadata,lifecycle,aliases,tags,visibility,id FROM worldstudio.setting_card_version WHERE id='"+v1+"'");
                String rev3=id();sql(c,revision(rev3,w,3,rev));manifest(c,rev3,w,card,v3);seal(c,rev3);
                sql(c,"UPDATE worldstudio.world SET current_revision_id='"+rev3+"' WHERE id='"+w+"'"); c.commit();
            }
            // Truly new JDBC connection; no ORM/session cache can supply these values.
            try(var c=db.connect()) {
                assertEquals(List.of("private","public","private"),rows(c,"SELECT visibility FROM worldstudio.setting_card_version WHERE card_id='"+card+"' ORDER BY version_no"));
                assertEquals(List.of(v1),rows(c,"SELECT restored_from_version_id::text FROM worldstudio.setting_card_version WHERE id='"+v3+"'"));
                assertEquals(List.of("  첫 줄  \n다음 줄"),rows(c,"SELECT body FROM worldstudio.setting_card_version WHERE id='"+v1+"'"));
                assertEquals(List.of("{태그2,태그1}"),rows(c,"SELECT tags::text FROM worldstudio.setting_card_version WHERE id='"+v3+"'"));
                assertEquals(List.of("{길동,길동}"),rows(c,"SELECT aliases::text FROM worldstudio.setting_card_version WHERE id='"+v3+"'"));
                assertEquals(List.of("자유 분류"),rows(c,"SELECT classification FROM worldstudio.setting_card_version WHERE id='"+v3+"'"));
                assertEquals(List.of("claim:원문 근거"),rows(c,"SELECT (semantic_metadata->>'kind')||':'||(semantic_metadata->>'quote') FROM worldstudio.setting_card_version WHERE id='"+v3+"'"));
                assertEquals(List.of("8"),rows(c,"SELECT count(DISTINCT card_type) FROM worldstudio.setting_card_version"));
                assertEquals(List.of("7"),rows(c,"SELECT count(DISTINCT area_code) FROM worldstudio.setting_card_version"));
                assertEquals(List.of("2"),rows(c,"SELECT count(*) FROM worldstudio.relationship_version"));
                assertEquals(List.of("0"),rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='public'"));
            }
            flyway.validate(); assertEquals(0,flyway.migrate().migrationsExecuted);
            System.out.println("Independent PostgreSQL: Content/Auth absent; 13 tables; 8 types/7 areas; snapshots; rejection/rollback; privacy restore; new connection; validate; rerun=0");
        }
    }
    static String version(String v,String card,String w,int no,String visibility,String restored) {
        return "INSERT INTO worldstudio.setting_card_version(id,card_id,world_id,version_no,title,body,card_type,area_code,classification,semantic_metadata,aliases,tags,visibility,restored_from_version_id) VALUES ('"+v+"','"+card+"','"+w+"',"+no+",'홍길동','  첫 줄  '||chr(10)||'다음 줄','character','basic','자유 분류','{\"kind\":\"claim\",\"quote\":\"원문 근거\"}',ARRAY['길동','길동'],ARRAY['태그2','태그1'],'"+visibility+"',"+(restored==null?"NULL":"'"+restored+"'")+")";
    }
    static String revision(String rev,String w,int no,String restored) {
        return "INSERT INTO worldstudio.world_revision(id,world_id,revision_no,name,description,restored_from_revision_id) VALUES ('"+rev+"','"+w+"',"+no+",'확정 세계','원문',"+(restored==null?"NULL":"'"+restored+"'")+")";
    }
    static void manifest(Connection c,String rev,String w,String card,String v) throws SQLException {
        sql(c,"INSERT INTO worldstudio.world_revision_card(world_id,revision_id,card_id,version_id) VALUES ('"+w+"','"+rev+"','"+card+"','"+v+"')");
    }
    static void seal(Connection c,String rev) throws SQLException { sql(c,"UPDATE worldstudio.world_revision SET sealed=true WHERE id='"+rev+"'"); }
}
