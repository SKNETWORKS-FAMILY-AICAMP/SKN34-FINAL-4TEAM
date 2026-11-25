package ai.storyfork.operations.llmops.service

import java.math.MathContext
import java.security.MessageDigest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.StringNode

/*
 * What an evaluation dataset item has to look like (#868), read from the AI service scorers (app/evaluation/service.py, simulation.py, routing.py, extraction.py) and the items of the
 * seed sets (DatasetRulesTest checks every real item against these rules): an item the scorer would refuse makes every later evaluation of that set fail, so it is
 * refused at the upload. The scorer is picked by the set name like the evaluation service does it.
 */

internal const val POOL_PREFIX = "optimize."
private val GATE_SETS = EVALUATION_SETS.values.toSet()
private const val POOL = "pool"

/** gate = the evaluation set of a prompt (the candidate gate), pool = optimize.<gate> (what the prompt improvement trains on), general = every other name. */
internal fun datasetKind(name: String) = when {
    name in GATE_SETS -> "gate"
    name.startsWith(POOL_PREFIX) && name.removePrefix(POOL_PREFIX) in GATE_SETS -> POOL
    else -> "general"
}

/** The set a gate shares its questions with (never put the same input in both): gate -> its pool and pool -> its gate. */
internal fun pairedDataset(name: String): String? = when (datasetKind(name)) {
    "gate" -> POOL_PREFIX + name
    POOL -> name.removePrefix(POOL_PREFIX)
    else -> null
}

private enum class Scorer { QA, ACT, NARRATE, ROUTING, EXTRACTION, GEVAL }

/** qa. is Ragas, the two simulation sets, the routing set and the extraction set are scored by code, everything else is GEval; a pool is scored like its gate. */
private fun scorerOf(dataset: String): Scorer {
    val base = if (datasetKind(dataset) == POOL) dataset.removePrefix(POOL_PREFIX) else dataset
    return when {
        base.startsWith("qa.") -> Scorer.QA
        base == "simulation.act" -> Scorer.ACT
        base == "simulation.narrate" -> Scorer.NARRATE
        base == "decision_guard.routing" -> Scorer.ROUTING
        base == "extraction.extract" -> Scorer.EXTRACTION
        else -> Scorer.GEVAL
    }
}

/** The first thing about the line that the scorer of [dataset] would refuse, or null. Every evaluation reads the input as an object. */
internal fun lineProblem(dataset: String, input: JsonNode, expectedOutput: JsonNode?, metadata: JsonNode?): String? {
    if (!input.isObject) return "input은 JSON 객체여야 해요."
    val scorer = scorerOf(dataset)
    inputProblem(scorer, input)?.let { return it }
    if (expectedOutput == null || expectedOutput.isNull || emptyValue(expectedOutput)) return "expectedOutput이 필요해요."
    expectedProblem(scorer, input, expectedOutput)?.let { return it }
    metadataProblem(scorer, metadata)?.let { return it }
    return if (datasetKind(dataset) == POOL) splitProblem(metadata) else null
}

private fun emptyValue(node: JsonNode) = (node.isString && node.stringValue().isBlank()) || ((node.isObject || node.isArray) && node.size() == 0)

private fun isText(node: JsonNode?) = node != null && node.isString
private fun filled(node: JsonNode?) = node != null && node.isString && node.stringValue().isNotBlank()

private fun inputProblem(scorer: Scorer, input: JsonNode): String? = when (scorer) {
    Scorer.QA -> when {
        !filled(input.get("question")) -> "input.question이 필요해요."
        input.get("contexts").let { it == null || !it.isArray || it.size() == 0 || !it.values().all(::filled) } -> "input.contexts(글 목록)가 필요해요."
        else -> null
    }
    Scorer.ACT -> if (input.get("data")?.isObject == true) null else "input.data(객체)가 필요해요."
    Scorer.NARRATE -> when {
        input.get("data")?.isObject != true -> "input.data(객체)가 필요해요."
        input.get("set")?.let { it.isString && it.stringValue() in setOf("narration", "monologue") } != true -> "input.set은 narration 또는 monologue여야 해요."
        else -> null
    }
    // routing.py generate: request is the text the guard judges and history, when it is there, a list (the turns are sent on as they are).
    Scorer.ROUTING -> when {
        !filled(input.get("request")) -> "input.request가 필요해요."
        input.has("history") && !input.get("history").isArray -> "input.history는 목록이어야 해요."
        else -> null
    }
    Scorer.EXTRACTION -> input.let { episode ->
        val number = episode.get("number")
        if (number != null && number.isIntegralNumber && number.canConvertToLong() && number.asLong() >= 1 && isText(episode.get("title")) && isText(episode.get("body"))) null
        else "input에는 number(1 이상 정수)·title·body가 필요해요."
    }
    Scorer.GEVAL -> null
}

private fun expectedProblem(scorer: Scorer, input: JsonNode, expected: JsonNode): String? = when (scorer) {
    Scorer.EXTRACTION -> goldProblem(input.get("body").stringValue(), expected)
    Scorer.ROUTING -> if (routingAnswerFits(expected)) null else "expectedOutput이 정답(guard·capabilities) 모양이 아니에요."
    else -> if (expected.isString) null else "expectedOutput은 글이어야 해요."
}

/** What the guard scorer compares (routing.py evaluate): the guard as text and the features the guard should have picked as a list of feature names (a name that is no text would not even be comparable). */
private fun routingAnswerFits(expected: JsonNode) =
    isText(expected.get("guard")) && expected.get("capabilities")?.let { list -> list.isArray && list.values().all(::isText) } == true

private fun metadataProblem(scorer: Scorer, metadata: JsonNode?): String? = when (scorer) {
    Scorer.GEVAL -> if (filled(metadata?.get("criteria"))) null else "metadata.criteria가 필요해요."
    Scorer.ACT, Scorer.NARRATE -> if (judgeFits(metadata?.get("judge"))) null else "metadata.judge(character·scene·facts)가 필요해요."
    else -> null
}

/** The inputs of the rubric (simulation.py _judge_inputs): the character text (empty for a narration), the scene lines {by, text} and the facts {id, text}. */
private fun judgeFits(judge: JsonNode?): Boolean {
    fun listOf(key: String, a: String, b: String) = judge?.get(key)?.let { list -> list.isArray && list.values().all { it.isObject && isText(it.get(a)) && isText(it.get(b)) } } == true
    return judge != null && judge.isObject && isText(judge.get("character")) && listOf("scene", "by", "text") && listOf("facts", "id", "text")
}

private fun splitProblem(metadata: JsonNode?): String? {
    val split = metadata?.get("split")
    return if (split == null || split.isNull || (split.isString && split.stringValue() in setOf("train", "val"))) null else "metadata.split은 train 또는 val이어야 해요."
}

private const val GOLD_SHAPE = "expectedOutput이 정답표(mentions·statements·relationships) 모양이 아니에요."
private val SETTING_DOCUMENTS = setOf("identity", "soul", "goal")   // the character documents a statement settles in (the memory document is the plot)
private const val MIN_OBJECT_MENTIONS = 2   // an object counts as a setting only when the episode names it this often

/**
 * The gold table (extraction.py Gold) and the one rule that makes the item scoreable: its recall is defined only when some core answer is a setting (a mention that is not
 * an object seen less than twice, a statement of an identity·soul·goal document, a relation between two such mentions with a character on one side).
 */
private fun goldProblem(body: String, gold: JsonNode): String? {
    fun entries(key: String) = gold.get(key)?.takeIf { it.isArray }?.values()?.toList()
    val mentions = entries("mentions") ?: return GOLD_SHAPE
    val statements = entries("statements") ?: return GOLD_SHAPE
    val relations = entries("relationships") ?: return GOLD_SHAPE
    fun fits(node: JsonNode, vararg keys: String) = node.isObject && keys.all { isText(node.get(it)) } && node.get("core")?.isBoolean == true
    val shaped = mentions.all { fits(it, "name", "kind") && it.get("aliases")?.let { aliases -> aliases.isArray && aliases.values().all(::isText) } == true } &&
        statements.all { fits(it, "kind", "document", "quote") } && relations.all { fits(it, "source", "target", "label") }
    if (!shaped) return GOLD_SHAPE
    fun word(node: JsonNode, key: String) = node.get(key).stringValue()
    fun core(node: JsonNode) = node.get("core").asBoolean()
    fun setting(mention: JsonNode) = word(mention, "kind") != "object" ||
        (listOf(word(mention, "name")) + mention.get("aliases").values().map { it.stringValue() }).maxOf { occurrences(body, it) } >= MIN_OBJECT_MENTIONS
    val byName = mentions.associateBy { word(it, "name") }
    val counts = mentions.any { core(it) && setting(it) } || statements.any { core(it) && word(it, "document") in SETTING_DOCUMENTS } ||
        relations.any { relation ->
            val ends = listOfNotNull(byName[word(relation, "source")], byName[word(relation, "target")])
            core(relation) && ends.size == 2 && ends.all(::setting) && ends.any { word(it, "kind") == "character" }
        }
    return if (counts) null else "정답표에 설정에 드는 core 정답이 하나 이상 있어야 해요."
}

/** Python's str.count, which is how the scorer counts a name in the episode: non-overlapping, and an empty part is found once more than the text has characters. */
private fun occurrences(text: String, part: String) = Regex.escape(part).toRegex().findAll(text).count()

/**
 * SHA-256 of the input with every object's keys in order (so key order and spacing never tell two equal inputs apart; an array keeps its order) and every float spelled the way
 * Langfuse stores it: the input of an item already in a set comes back from Langfuse, which keeps 16 digits of a float (0.38461538461538464 is read back as 0.3846153846153846,
 * 1.0 as 1), so the same question uploaded again would not be found. A text inside is left as it is (Langfuse does not touch it either).
 */
internal fun inputHash(input: JsonNode): String =
    MessageDigest.getInstance("SHA-256").digest(canonical(input).toByteArray()).joinToString("") { "%02x".format(it) }

private fun canonical(node: JsonNode): String = when {
    node.isObject -> node.properties().sortedBy { it.key }.joinToString(",", "{", "}") { "${StringNode.valueOf(it.key)}:${canonical(it.value)}" }   // the key as a JSON text, escaped like a value
    node.isArray -> node.values().joinToString(",", "[", "]") { canonical(it) }
    // 12 of the 16 digits Langfuse keeps (a dropped last digit moves a float over a rounding edge only about once in ten thousand); 1.0 is the integer 1
    node.isFloatingPointNumber -> node.decimalValue().round(MathContext(12)).stripTrailingZeros().toPlainString()
    else -> node.toString()
}

/** val when the first 32 bits of the hash, as a share of 2^32, are below [valShare] (the pool's own share of val items), train otherwise: the same input always lands on the same side. */
internal fun splitFor(hash: String, valShare: Double) = if (hash.take(8).toLong(16) / 4294967296.0 < valShare) "val" else "train"
