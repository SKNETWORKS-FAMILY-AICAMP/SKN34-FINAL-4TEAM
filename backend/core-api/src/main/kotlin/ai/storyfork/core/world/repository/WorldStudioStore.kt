package ai.storyfork.core.world.repository

import ai.storyfork.core.world.domain.StudioWorld
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper

class WorldStudioStore(private val db:JdbcTemplate,private val mapper:ObjectMapper,private val tx:TransactionTemplate) {
 init {
  db.execute("CREATE TABLE IF NOT EXISTS studio_world(id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(50) NOT NULL, version INT NOT NULL, payload TEXT NOT NULL)")
  db.execute("CREATE TABLE IF NOT EXISTS studio_world_revision(world_id VARCHAR(36) REFERENCES studio_world(id), version INT, payload TEXT NOT NULL, PRIMARY KEY(world_id,version))")

 }
 fun <T:Any> transaction(action:()->T):T=tx.execute {action()}
 fun list(owner:String)=db.query("SELECT payload FROM studio_world WHERE owner_id=? ORDER BY id",{r,_->mapper.readValue(r.getString(1),StudioWorld::class.java)},owner)
 fun read(owner:String,id:String)=db.query("SELECT payload FROM studio_world WHERE id=? AND owner_id=?",{r,_->mapper.readValue(r.getString(1),StudioWorld::class.java)},id,owner).singleOrNull()
 fun insert(owner:String,w:StudioWorld) {db.update("INSERT INTO studio_world VALUES(?,?,?,?)",w.id,owner,w.version,mapper.writeValueAsString(w));revision(w)}
 fun save(owner:String,previous:Int,w:StudioWorld) {
  require(db.update("UPDATE studio_world SET version=?,payload=? WHERE id=? AND owner_id=? AND version=?",w.version,mapper.writeValueAsString(w),w.id,owner,previous)==1) {"다른 곳에서 변경되었습니다. 다시 열어 비교한 뒤 저장하세요."}
  revision(w)
 }
 private fun revision(w:StudioWorld) {db.update("INSERT INTO studio_world_revision VALUES(?,?,?)",w.id,w.version,mapper.writeValueAsString(w))}
 fun revisions(id:String)=db.query("SELECT payload FROM studio_world_revision WHERE world_id=? ORDER BY version",{r,_->mapper.readValue(r.getString(1),StudioWorld::class.java)},id)
}
