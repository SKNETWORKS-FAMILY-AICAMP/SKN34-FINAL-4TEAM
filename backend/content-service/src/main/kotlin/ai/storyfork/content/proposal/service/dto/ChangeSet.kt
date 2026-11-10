package ai.storyfork.content.proposal.service.dto

import ai.storyfork.content.proposal.client.dto.AiRunSourceRef

data class ChangeSpan(val start: Int, val end: Int)
data class ChangeField(val name: String, val value: String)
data class ChangeTarget(val type: String, val id: String, val episode: Int, val baseVersion: Int?, val beforeHash: String?)
data class ChangeOperation(val op: String, val target: ChangeTarget, val span: ChangeSpan? = null,
    val content: String? = null, val fields: List<ChangeField> = emptyList(), val evidenceRefs: List<String> = emptyList())
data class ChangeEvidence(val id: String, val source: AiRunSourceRef, val span: ChangeSpan, val sourceHash: String, val isMock: Boolean)
data class ChangeVersionRef(val proposalId: String, val proposalVersion: Int, val proposalHash: String)

/** Content 내부의 검증된 생성 결과만 접수한다. 공개 HTTP 준비 endpoint는 제공하지 않는다. */
data class PrepareChangeSetRequest(val runId: String, val forkId: String?, val baseVersion: Int,
    val operations: List<ChangeOperation>, val evidence: List<ChangeEvidence>, val isMock: Boolean,
    val previous: ChangeVersionRef? = null)

/** 순서가 있는 고정 schema를 hash한다. 상태와 시각은 manifest 밖에 둔다. */
data class ChangeSet(val proposalId: String, val proposalVersion: Int, val runId: String, val workId: String,
    val forkId: String?, val baseVersion: Int, val affectedDocuments: List<ChangeTarget>,
    val operations: List<ChangeOperation>, val evidence: List<ChangeEvidence>, val isMock: Boolean,
    val idempotencyKey: String, val schemaVersion: Int = 1)
data class ChangeSetResponse(val changeSet: ChangeSet, val proposalHash: String, val status: String,
    val approvalFields: List<String>)
data class ChangeDecisionRequest(val proposalVersion: Int, val proposalHash: String, val decision: String)
data class ChangeResultVersion(val targetId: String, val before: Int?, val after: Int, val versionId: String)
data class ChangeReceipt(val decisionId: String, val proposalId: String, val proposalVersion: Int,
    val proposalHash: String, val actorRef: String, val decision: String, val applicationId: String?,
    val outcome: String, val resultVersions: List<ChangeResultVersion>, val committedAt: String)
