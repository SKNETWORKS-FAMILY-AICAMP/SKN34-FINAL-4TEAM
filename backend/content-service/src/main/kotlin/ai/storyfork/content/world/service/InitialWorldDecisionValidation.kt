package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.*

object InitialWorldDecisionValidation {
    fun review(input:InitialWorldInput,current:InitialWorldCandidateOutput,request:InitialWorldDecisionRequest):InitialWorldCandidateOutput {
        require(request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
        require(request.expectedDecisionSequence in 0..9007199254740991L)
        require(request.action in setOf("approve","edit","hold","reject"))
        require(request.comment.codePointCount(0,request.comment.length)<=3000)
        require(request.comment.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8)==request.comment)
        require((request.action=="edit")== (request.editedCandidate!=null))
        val content=request.editedCandidate ?: current
        require(content.localRef==current.localRef)
        if(request.action=="edit") require(content.provenance=="author_revision" && content.evidence.isEmpty())
        InitialWorldOutputValidation.candidate(input,content)
        return content
    }
}
