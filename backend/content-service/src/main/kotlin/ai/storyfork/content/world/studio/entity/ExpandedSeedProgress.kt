package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID

@Entity
@Table(name="expanded_seed_progress",schema="worldstudio")
class ExpandedSeedProgress(@Id @Column(name="world_id") val worldId:UUID,
    @Column(name="input_hash",columnDefinition="text",nullable=false) val inputHash:String,
    @Column(name="next_chunk",nullable=false) var nextChunk:Int=0,
    @Column(nullable=false) var completed:Boolean=false,
    @Column(name="base_draft_revision",nullable=false) val baseDraftRevision:Long=0,
    @Column(name="base_graph_version",nullable=false) val baseGraphVersion:Long=0,
    @Column(name="base_revision_id") val baseRevisionId:UUID?=null,
    @Column(name="base_visibility",columnDefinition="text",nullable=false) val baseVisibility:String="private")
