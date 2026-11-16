// DEC-51: 기존 StudioRelationship 관계를 회차별 연결(RELATED)로 한 번 옮긴다.
// 계약: docs/design/worldstudio-independent-schema.md#회차별-관계--dec-51
//
// ⚠ 아직 실행하지 않은 스크립트다. 공유 Neo4j 데이터를 바꾸므로 실행 전에 사용자 승인을 받고, 복제본·스테이징에서 먼저 확인한다.
//
// 실행: cypher-shell -a <bolt URI> -u neo4j -p <비밀번호> -d <데이터베이스> -f infrastructure/neo4j/dec51-relationship-edges.cypher
// 시점: 새 Content 코드를 올린 직후에 실행한다. 그 전에는 새 코드가 관계가 있는 기존 세계관을 RELATIONSHIP_VERSION_MISMATCH(409)로 거절하고,
//       이전한 세계관은 옛 코드가 읽지 못한다. 실행 중에는 WorldStudio 저장 요청이 없어야 한다.
// 멱등: 이미 옮긴 관계(같은 relationId의 RELATED 연결이 있는 것)는 다시 만들지 않는다. 한 트랜잭션(:begin ~ :commit)이라 중간에 실패하면 전부 취소된다.
//
// 하는 일
//   1) 두 끝점(SOURCE·TARGET)이 모두 있는 관계를 fromEpisode=1, ended=false RELATED 연결로 옮긴다(payload 그대로).
//   2) 세계관 노드의 count를 새 뜻(그 세계관의 RELATED 연결 수)으로 다시 센다. PG의 graphVersion과 노드 version·requestKey·requestHash는 건드리지 않는다.
//   3) 옮긴 관계 노드와 payload 없는 ID 예약 노드(StudioRelationship)를 지운다. 끝이 비어 옮기지 못한 관계는 지우지 않고 남긴다(DEC-51은 끝이 빈 관계를 저장하지 않는다).
//   4) 점검 조회: 남은 옛 관계와 count가 연결 수와 다른 세계관을 돌려준다. 둘 다 비어 있어야 정상이다(남은 관계는 사람이 보고 정한다).

// 사전 점검(읽기 전용): 옮길 수 있는 관계 수와 끝이 비어 옮기지 못하는 관계 수를 남겨 둔다.
MATCH (:StudioRelationshipWorld)-[:HAS_RELATION]->(r:StudioRelationship)
WHERE r.payload IS NOT NULL
OPTIONAL MATCH (r)-[:SOURCE]->(a:StudioCard)
OPTIONAL MATCH (r)-[:TARGET]->(b:StudioCard)
RETURN count(r) AS legacyRelations, count(CASE WHEN a IS NOT NULL AND b IS NOT NULL THEN r END) AS movable;

:begin

MATCH (w:StudioRelationshipWorld)-[:HAS_RELATION]->(r:StudioRelationship)
WHERE r.payload IS NOT NULL
MATCH (r)-[:SOURCE]->(a:StudioCard), (r)-[:TARGET]->(b:StudioCard)
WHERE NOT EXISTS { MATCH ()-[:RELATED {relationId: r.id}]->() }
CREATE (a)-[e:RELATED {relationId: r.id, worldId: w.id, fromEpisode: 1, ended: false}]->(b)
SET e.payload = r.payload;

MATCH (w:StudioRelationshipWorld)
OPTIONAL MATCH ()-[e:RELATED]->() WHERE e.worldId = w.id
WITH w, count(e) AS total
SET w.count = total;

MATCH (r:StudioRelationship)
WHERE r.payload IS NULL OR EXISTS { MATCH ()-[:RELATED {relationId: r.id}]->() }
DETACH DELETE r;

// 점검: 옮기지 못하고 남은 옛 관계(끝이 비어 있던 것). 비어 있어야 한다.
MATCH (r:StudioRelationship) RETURN r.id AS notMovedRelationId, r.worldId AS worldId;

// 점검: count가 연결 수와 다른 세계관. 비어 있어야 한다.
MATCH (w:StudioRelationshipWorld)
OPTIONAL MATCH ()-[e:RELATED]->() WHERE e.worldId = w.id
WITH w, count(e) AS total
WHERE w.count <> total
RETURN w.id AS mismatchedWorld, w.count AS recordedCount, total AS edgeCount;

:commit

// 선택(검증 뒤 따로 실행): 옛 노드의 유일성 제약은 비어 있어도 해롭지 않다. 지우려면 데이터 변경과 같은 트랜잭션에 둘 수 없어 별도로 실행한다.
// DROP CONSTRAINT studiorelationship_id IF EXISTS;
