package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.DatasetItems
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations._common.exception.CopyrightConfirmRequiredException
import ai.storyfork.operations._common.exception.DatasetInvalidException
import ai.storyfork.operations._common.exception.DatasetTooLargeException
import ai.storyfork.operations._common.service.dto.DatasetLineError
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.dto.DatasetItem
import ai.storyfork.operations.llmops.service.dto.DatasetItemPage
import ai.storyfork.operations.llmops.service.dto.DatasetUploadResponse
import ai.storyfork.operations.llmops.service.dto.EvalDataset
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException
import tools.jackson.core.JacksonException
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode

private const val LLM = "llm"
private const val NAME_MAX = 200
private const val MAX_ITEMS = 500
private const val MAX_PAGE_SIZE = 100
private const val READ_PAGE = 100   // the page size of the items read for the list and for the duplicate check

/** The only keys of an uploaded line; a typo such as expected_output is an error, not a dropped value. */
private val LINE_KEYS = setOf("input", "expectedOutput", "metadata")
private const val GATE_NOTICE = "gate 세트에 올리면 다음 평가에서 기준 버전을 다시 평가해요(비용 발생)"
private const val NO_SHARE = "이 풀에는 train·val 문항이 모두 있어야 split을 자동으로 정할 수 있어요. metadata.split(train 또는 val)을 적어 주세요."

/** One valid line of an upload ([number] is its place in the file): what Langfuse stores for the item, and the hash of its input. */
private class Line(val number: Int, val input: JsonNode, val expectedOutput: JsonNode?, val metadata: JsonNode?, val hash: String)

/**
 * The evaluation datasets of Langfuse (#868). Langfuse is the source of truth: this service lists the sets with their kind and the prompt that names each as its evaluation
 * set, pages through a set's items and adds the items of a JSONL file to a set that already exists (no new sets, no edits or deletes of items). An upload is all or nothing:
 * every line is checked first (the format, what the scorer of that set reads, then the questions: an input that is already in the set, in its pair set or twice in the file
 * is refused so a test question never ends up in training) and one bad line (or a missing set) creates nothing; a Langfuse failure halfway takes back what was created.
 */
@Service
class DatasetService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val activities: AdminActivityService,
    private val mapper: JsonMapper,
) {
    /** A line is one JSON value with nothing after it: Jackson 3 already fails on trailing text, and it is spelled out so a mapper configured otherwise cannot let it through. */
    private val reader = mapper.readerFor(JsonNode::class.java).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)

    fun list(member: OperationsMember): List<EvalDataset> {
        permissions.requirePermission(member, LLM)
        // A Langfuse dataset carries neither a count nor the time of its newest item, so every item of every set is read, in parallel like the prompt reads: the listing's order is
        // not relied on (the newest item can be anywhere), so the maximum is taken over all of them, the same way the evaluation service decides whether a baseline Run is valid.
        return langfuse.datasets().parallelStream().map { node ->
            val name = node.path("name").asString()
            val read = allItems(name)
            val newest = read.items.mapNotNull { it.path("createdAt").instantOrNull() }.maxOrNull()
            EvalDataset(name, EVALUATION_SETS.entries.firstOrNull { it.value == name }?.key, datasetKind(name), read.total, newest, node.path("description").textOrNull())
        }.toList()
    }

    /** [page] is 1-based like Langfuse's. */
    fun items(member: OperationsMember, name: String, page: Int, size: Int): DatasetItemPage {
        permissions.requirePermission(member, LLM)
        requireName(name)
        require(page >= 1 && size in 1..MAX_PAGE_SIZE) { "Invalid page." }
        val read = langfuse.datasetItems(name, page, size)
        return DatasetItemPage(read.items.map { DatasetItem(it.path("id").asString(), it.get("input"), it.get("expectedOutput"), it.get("metadata")) }, read.total)
    }

    /**
     * The checks come cheapest first and nothing leaves this service before all of them passed: permission, name, the copyright confirmation (the items are stored in
     * Langfuse), the file, its size, every line. Only then is the set looked up (404) and its items (and its pair's) read for the duplicate check; the items are created in
     * file order.
     */
    fun upload(member: OperationsMember, name: String, file: MultipartFile?, copyrightConfirmed: Boolean?): DatasetUploadResponse {
        permissions.requirePermission(member, LLM)
        requireName(name)
        if (copyrightConfirmed != true) throw CopyrightConfirmRequiredException()
        val fileName = file?.originalFilename
        require(file != null && fileName != null && fileName.endsWith(".jsonl", ignoreCase = true)) { "A .jsonl file is required." }
        val lines = parse(text(file), name)
        langfuse.dataset(name)   // a set Langfuse does not have is a 404 (new sets are out of scope)
        val ready = resolve(lines, name, pairedDataset(name)?.takeIf(::exists))
        val made = mutableListOf<String>()
        try {
            for (line in ready) made += langfuse.createDatasetItem(name, line.input, line.expectedOutput, line.metadata)
        } catch (error: Exception) {
            // ponytail: a best-effort take-back; one that fails too leaves its item in the set (the first failure is the one reported).
            made.forEach { runCatching { langfuse.deleteDatasetItem(it) } }
            throw error
        }
        val kind = datasetKind(name)
        activities.record(member, "DATASET_UPLOAD", "DATASET", name, "$kind · ${made.size}건 · $fileName")
        return DatasetUploadResponse(made.size, kind, GATE_NOTICE.takeIf { kind == "gate" })
    }

    private fun requireName(name: String) = require(name.isNotBlank() && name.length <= NAME_MAX) { "Invalid dataset." }

    /** UTF-8 only: a lenient decode would store replacement characters in the evaluation data. */
    private fun text(file: MultipartFile): String = try {
        Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(file.bytes)).toString().removePrefix("\uFEFF")
    } catch (_: CharacterCodingException) {
        throw IllegalArgumentException("The file is not UTF-8 text.")
    }

    /** Blank lines are skipped and do not count; a line number in an error is the line's place in the file. */
    private fun parse(text: String, dataset: String): List<Line> {
        val filled = text.lines().withIndex().filter { it.value.isNotBlank() }
        if (filled.size > MAX_ITEMS) throw DatasetTooLargeException()
        require(filled.isNotEmpty()) { "The file has no items." }
        val errors = mutableListOf<DatasetLineError>()
        val lines = filled.mapNotNull { (index, text) ->
            try {
                line(index + 1, text, dataset)
            } catch (error: IllegalArgumentException) {
                errors += DatasetLineError(index + 1, checkNotNull(error.message))
                null
            }
        }
        if (errors.isNotEmpty()) throw DatasetInvalidException(errors)
        return lines
    }

    /** The first problem of a line is its error (the same texts and rules as the screen's own check, so a file reads the same on both sides). */
    private fun line(number: Int, text: String, dataset: String): Line {
        val node = try {
            reader.readTree(text)
        } catch (_: JacksonException) {
            throw IllegalArgumentException("JSON으로 읽을 수 없어요.")
        }
        require(node.isObject) { "줄 하나가 JSON 객체여야 해요." }
        val unknown = node.propertyNames().filter { it !in LINE_KEYS }
        require(unknown.isEmpty()) { "알 수 없는 칸이 있어요: ${unknown.joinToString(", ")}" }
        val input = node.get("input")
        require(input != null && !input.isNull) { "input이 필요해요." }
        val expected = node.get("expectedOutput")?.takeUnless { it.isNull }
        val metadata = node.get("metadata")?.takeUnless { it.isNull }
        require(metadata == null || metadata.isObject) { "metadata는 JSON 객체여야 해요." }
        lineProblem(dataset, input, expected, metadata)?.let { throw IllegalArgumentException(it) }
        return Line(number, input, expected, metadata, inputHash(input))
    }

    /**
     * The questions: a line whose input is already in this set, in its pair set (gate and pool never share a question) or earlier in the file is refused, and a pool line
     * without a split gets one from its input hash in the pool's own proportion of val items. Every such line is reported at once; the lines to create come back otherwise.
     */
    private fun resolve(lines: List<Line>, name: String, pair: String?): List<Line> {
        val here = allItems(name).items
        val inHere = here.map { inputHash(it.path("input")) }.toSet()
        val inPair = pair?.let { allItems(it).items }.orEmpty().map { inputHash(it.path("input")) }.toSet()
        val share = if (datasetKind(name) == "pool") valShare(here) else null
        val first = HashMap<String, Int>()
        val errors = mutableListOf<DatasetLineError>()
        val ready = lines.map { line ->
            var problem = when {
                line.hash in first -> "파일의 ${first.getValue(line.hash)}번째 줄과 input이 같아요."
                line.hash in inHere -> "이 세트에 이미 있는 input이에요."
                line.hash in inPair -> "짝 세트($pair)에 이미 있는 input이에요. 시험 문제를 학습에 섞지 않아요."
                else -> null
            }
            first.putIfAbsent(line.hash, line.number)
            var made = line
            if (problem == null && datasetKind(name) == "pool" && line.metadata?.get("split")?.isString != true) {   // the rules checked that a split that is there is train or val
                if (share == null) problem = NO_SHARE else made = withSplit(line, splitFor(line.hash, share))
            }
            problem?.let { errors += DatasetLineError(line.number, it) }
            made
        }
        if (errors.isNotEmpty()) throw DatasetInvalidException(errors)
        return ready
    }

    /** The share of val among the pool's train and val items; none while one of the two is missing (then the proportion is not known). */
    private fun valShare(items: List<JsonNode>): Double? {
        val splits = items.mapNotNull { it.path("metadata").path("split").textOrNull() }.filter { it == "train" || it == "val" }
        val validation = splits.count { it == "val" }
        return if (validation > 0 && validation < splits.size) validation.toDouble() / splits.size else null
    }

    private fun withSplit(line: Line, split: String): Line {
        val metadata = (line.metadata ?: mapper.createObjectNode()).deepCopy() as ObjectNode
        metadata.put("split", split)
        return Line(line.number, line.input, line.expectedOutput, metadata, line.hash)
    }

    /** Every item of a set, page by page, with the total Langfuse reports: the duplicate check and the list's newest-item time need all of them. */
    private fun allItems(name: String): DatasetItems {
        val items = mutableListOf<JsonNode>()
        var page = 1
        while (true) {
            val read = langfuse.datasetItems(name, page++, READ_PAGE)
            items += read.items
            if (read.items.isEmpty() || items.size >= read.total) return DatasetItems(items, read.total)
        }
    }

    private fun exists(name: String) = try {
        langfuse.dataset(name)
        true
    } catch (error: ResponseStatusException) {
        if (error.statusCode == HttpStatus.NOT_FOUND) false else throw error
    }
}
