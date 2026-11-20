package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.security.MessageDigest
import tools.jackson.databind.json.JsonMapper

internal fun historicalFixture(template:GenreTemplate,mapper:JsonMapper):HistoricalFingerprint {
    fun hash(op:String,value:Any)=MessageDigest.getInstance("SHA-256")
        .digest(mapper.writeValueAsBytes(listOf(op,template.worldId,value))).joinToString("") { "%02x".format(it) }
    val key="genre-template-${template.genre}"
    val payloads=GenreTemplateRepair.soulPayloads(template)
    return HistoricalFingerprint(template.genre,template.worldId,
        hash("create",CreateWorldRequest(template.name,template.description,template.worldId)),
        hash("edit",EditWorldDraftRequest(0,template.name,template.description,payloads,key=key)),
        hash("save",SaveWorldRequest(1,key)),payloads.map { HistoricalCardFingerprint(it.id,historicalPayloadHash(it,mapper)) })
}

internal fun historicalSyntheticFixtures():List<GenreTemplate> =
    listOf("korea_history","china_history","japan_history","england_history","france_history","italy_history","usa_history")
        .mapIndexed { index,genre ->
            val count=if(index<4) 23 else 22
            GenreTemplate(genre,java.util.UUID.randomUUID(),"합성 역사", "테스트",(0 until count).map {
                GenreTemplateCard(java.util.UUID.randomUUID(),"합성 카드 $it","합성 본문 $it","other")
            })
        }
