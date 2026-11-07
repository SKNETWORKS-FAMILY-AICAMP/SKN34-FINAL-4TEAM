package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID

/** 저장소 연결/마지막 요청 영수증 메타데이터. 관계 payload나 관계 이력은 PostgreSQL에 저장하지 않는다. */
@Entity
@Table(name="relationship_state",schema="worldstudio")
class WorldRelationshipState(
    @Id @Column(name="world_id") val worldId:UUID,
    @Column(name="graph_version",nullable=false) var graphVersion:Long=-1,
    @Column(name="creation_hash",nullable=false) val creationHash:String,
    @Column(name="request_key",nullable=false) var requestKey:String,
    @Column(name="request_hash",nullable=false) var requestHash:String,
    @Column(name="expected_draft_revision",nullable=false) var expectedDraftRevision:Long=-1,
    @Column(nullable=false) var completed:Boolean=false,
)
