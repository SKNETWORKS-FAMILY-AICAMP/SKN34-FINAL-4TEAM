package ai.storyfork.content.world

import ai.storyfork.content.world.service.InitialWorldEvidence
import ai.storyfork.content.world.service.InitialWorldInput
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import com.networknt.schema.InputFormat
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SpecificationVersion
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import tools.jackson.module.kotlin.KotlinModule

/** #219의 실제 Input 스키마와 공유 원문/근거를 검사한다. HTTP·DB·AI는 실행하지 않는다. */
class InitialWorldInputContractTest {
    private val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private fun artifact(name: String): String {
        val pinned = requireNotNull(javaClass.getResource("/initial-world-contract/$name")).readText()
        val canonical = Path.of("../../docs/design/initial-world-preprocessing", name)
        if (!Files.exists(canonical)) return pinned // #219 선행 병합 전의 명시적 고정본.
        val current = Files.readString(canonical)
        assertEquals(mapper.readTree(pinned), mapper.readTree(current), "#219 변경 시 고정 계약을 함께 갱신해야 합니다.")
        return current
    }
    private val fixture = mapper.readTree(artifact("honggildong.json"))["valid"]
    private val inputSchema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12) {
        it.schemas(mapOf("urn:storyfork:initial-world-contract" to artifact("contract.schema.json")))
    }.getSchema(SchemaLocation.of("urn:storyfork:initial-world-contract#/${'$'}defs/Input"))

    private fun errors(json: String) = inputSchema.validate(json, InputFormat.JSON) { context ->
        context.executionConfig { it.formatAssertionsEnabled(true) }
    }
    private fun input() = mapper.treeToValue(fixture["input"], InitialWorldInput::class.java)
    private fun evidence(node: JsonNode) = mapper.treeToValue(node, InitialWorldEvidence::class.java)

    @Test fun `shared input survives actual Kotlin JSON round trip and schema validation`() {
        val json = mapper.writeValueAsString(input())
        assertEquals(fixture["input"], mapper.readTree(json))
        assertEquals(emptyList<Any>(), errors(json))
        fixture["output"]["candidates"].forEach { candidate ->
            candidate["evidence"].forEach { input().validateEvidence(evidence(it)) }
        }
    }

    @Test fun `stored draft snapshot preserves shared IDs text and evidence and matches Input schema`() {
        val shared = input()
        val cards = shared.entities.map { entity ->
            CardPayload(entity.cardId, entity.name,
                shared.sources.singleOrNull { it.ownerId == entity.cardId && it.field == "body" }?.text ?: "",
                entity.entityType, "basic", aliases = entity.aliases)
        }
        val draft = WorldDraftResponse(shared.worldId, shared.basis.draftRevision, shared.basis.currentRevisionId,
            null, "홍길동전", "", cards, emptyList(), shared.basis.relationshipVersion, "current")
        val snapshot = InitialWorldInput.fromDraft(draft, shared.analysisId)
        val json = mapper.writeValueAsString(snapshot)
        assertEquals(emptyList<Any>(), errors(json))
        assertEquals(shared.entities, snapshot.entities)
        shared.sources.forEach { source -> assertEquals(source, snapshot.sources.single { it.sourceId == source.sourceId }) }
        assertEquals(1 + 2 * cards.size, snapshot.sources.size)
        mapper.readValue(json, InitialWorldInput::class.java).validateAgainst(draft)
        fixture["output"]["candidates"].forEach { candidate ->
            candidate["evidence"].forEach { snapshot.validateEvidence(evidence(it)) }
        }
        // 공유 fixture는 body 하나만 포함하므로 전체 저장 초안의 해시와 같다고 가정하지 않는다.
        assertNotEquals(shared.basis.inputHash, snapshot.basis.inputHash)
    }

    @Test fun `schema rejects invalid serialized version UUID missing field and additional field`() {
        fun changed(edit: (ObjectNode) -> Unit): String {
            val node = mapper.readTree(mapper.writeValueAsString(input())) as ObjectNode
            edit(node)
            return mapper.writeValueAsString(node)
        }
        listOf(
            changed { it.put("schemaVersion", "wrong") },
            changed { it.put("worldId", "not-a-uuid") },
            changed { it.remove("basis") },
            changed { it.put("unexpected", true) },
        ).forEach { assertFalse(errors(it).isEmpty(), it) }
    }

    @Test fun `shared evidence rejects wrong source quote hash and UTF16 boundary`() {
        val shared = input()
        val quote = evidence(fixture["output"]["candidates"][0]["evidence"][0])
        assertThrows<IllegalArgumentException> { shared.validateEvidence(quote.copy(sourceId = "card:${UUID.randomUUID()}:body")) }
        assertThrows<IllegalArgumentException> { shared.validateEvidence(quote.copy(quote = "다른 원문")) }
        assertThrows<IllegalArgumentException> { shared.validateEvidence(quote.copy(quoteHash = "0".repeat(64))) }
        val emoji = shared.sources.single().text.indexOf("😀").toLong()
        assertTrue(emoji >= 0)
        assertThrows<IllegalArgumentException> { shared.validateEvidence(quote.copy(start = emoji, end = emoji + 1, quote = "😀")) }
        assertThrows<IllegalArgumentException> { shared.copy(basis = shared.basis.copy(inputHash = "0".repeat(64))).validateEvidence(quote) }
    }
}
