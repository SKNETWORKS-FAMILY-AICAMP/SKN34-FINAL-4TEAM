package ai.storyfork.content.proposal.domain

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.proposal.service.dto.RunSelection

fun validateRunSelection(body: String,selection: RunSelection) {
    checkContent(selection.start>=0 && selection.end>selection.start && selection.end<=body.length,409,"선택 구간이 변경됐어요.")
    fun boundary(n: Int)=n==0 || n==body.length || !(body[n-1].isHighSurrogate() && body[n].isLowSurrogate())
    checkContent(boundary(selection.start) && boundary(selection.end) &&
        ChangeSetPolicy.hash(body.substring(selection.start,selection.end))==selection.sourceHash,409,"선택 원문이 변경됐어요.")
}
