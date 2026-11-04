package ai.storyfork.core.proposal.domain

import ai.storyfork.core._common.exception.checkContent

object ProposalTextPolicy {
    fun validate(text: String) = checkContent(!text.contains("data:image",ignoreCase=true) && !text.contains("[[image:",ignoreCase=true),422,"AI 제안에 이미지 데이터나 확인되지 않은 이미지 참조를 넣을 수 없어요.")
}
