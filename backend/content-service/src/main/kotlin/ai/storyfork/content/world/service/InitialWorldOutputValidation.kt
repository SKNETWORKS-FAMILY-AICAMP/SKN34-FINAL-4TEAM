package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.InitialWorldOutput
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.MapperFeature
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** AI의 형식 검증을 신뢰하지 않고 Content가 저장된 입력과 다시 대조한다. */
object InitialWorldOutputValidation {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build())
        .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
        .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES).build()

    fun parse(input:InitialWorldInput,json:String):InitialWorldOutput {
        val output=try { requireNotNull(mapper.readValue(json,InitialWorldOutput::class.java)) }
            catch(_:RuntimeException) { throw IllegalArgumentException("INVALID_AI_OUTPUT") }
        require(output.schemaVersion=="initial-world.v1")
        require(output.candidates.map { it.localRef }.distinct().size==output.candidates.size)
        val entities=input.entities.map { it.cardId }.toSet()
        output.diagnostics.forEach { text(it,3000) }
        output.candidates.forEach { c ->
            require(c.localRef.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
            require(c.type in setOf("fact","relation","rule","event","conjecture","goal","plan"))
            text(c.title,200);text(c.text,3000);text(c.condition,3000,0);text(c.timeText,3000,0)
            require(c.provenance=="ai_extraction" && c.evidence.isNotEmpty())
            require(c.polarity in setOf("asserted","denied"))
            require((c.type=="relation")== (c.relation!=null))
            require(c.type !in setOf("goal","plan") || c.subjectId!=null)
            val refs=c.relatedEntityIds.toMutableSet();c.subjectId?.let { refs.add(it) }
            c.relation?.let { r ->
                require(r.sourceCardId!=r.targetCardId)
                require(r.category in setOf("structural","emotional") && r.direction in setOf("directed","symmetric"))
                require(r.polarity in setOf("asserted","denied"));text(r.label,200)
                refs.add(r.sourceCardId);refs.add(r.targetCardId)
            }
            require(entities.containsAll(refs))
            c.evidence.forEach { input.validateEvidence(it) }
        }
        return output
    }

    private fun text(value:String,max:Int,min:Int=1) {
        require(value.codePointCount(0,value.length) in min..max)
        var i=0
        while(i<value.length) {
            val c=value[i++]
            if(Character.isHighSurrogate(c)) require(i<value.length && Character.isLowSurrogate(value[i++]))
            else require(!Character.isLowSurrogate(c))
        }
    }
}
