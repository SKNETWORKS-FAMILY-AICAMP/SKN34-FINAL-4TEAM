package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
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
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile
import tools.jackson.core.JacksonException
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

private const val LLM = "llm"
private const val NAME_MAX = 200
private const val MAX_ITEMS = 500
private const val MAX_PAGE_SIZE = 100

/** The only keys of an uploaded line; a typo such as expected_output is an error, not a dropped value. */
private val LINE_KEYS = setOf("input", "expectedOutput", "metadata")

/** One valid line of an upload: what Langfuse stores for the item. */
private class Line(val input: JsonNode, val expectedOutput: JsonNode?, val metadata: JsonNode?)

/**
 * The evaluation datasets of Langfuse (#868). Langfuse is the source of truth: this service lists the sets with the prompt that names each as its evaluation set,
 * pages through a set's items and adds the items of a JSONL file to a set that already exists (no new sets, no edits or deletes of items). An upload is
 * all or nothing: every line is checked first and one bad line (or a missing set) creates nothing; a Langfuse failure halfway takes back what was created.
 */
@Service
class DatasetService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val activities: AdminActivityService,
    mapper: JsonMapper,
) {
    /** A line is one JSON value with nothing after it: Jackson 3 already fails on trailing text, and it is spelled out so a mapper configured otherwise cannot let it through. */
    private val reader = mapper.readerFor(JsonNode::class.java).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)

    fun list(member: OperationsMember): List<EvalDataset> {
        permissions.requirePermission(member, LLM)
        // A Langfuse dataset carries no count, so each set's own item total is read (one item is enough), in parallel like the prompt reads.
        return langfuse.datasets().parallelStream().map { node ->
            val name = node.path("name").asString()
            EvalDataset(name, EVALUATION_SETS.entries.firstOrNull { it.value == name }?.key, langfuse.datasetItems(name, 1, 1).total, node.path("description").textOrNull())
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
     * Langfuse), the file, its size, every line. Only then is the set looked up (404) and the items created in file order.
     */
    fun upload(member: OperationsMember, name: String, file: MultipartFile?, copyrightConfirmed: Boolean?): DatasetUploadResponse {
        permissions.requirePermission(member, LLM)
        requireName(name)
        if (copyrightConfirmed != true) throw CopyrightConfirmRequiredException()
        val fileName = file?.originalFilename
        require(file != null && fileName != null && fileName.endsWith(".jsonl", ignoreCase = true)) { "A .jsonl file is required." }
        val lines = parse(text(file))
        langfuse.dataset(name)   // a set Langfuse does not have is a 404 (new sets are out of scope)
        val made = mutableListOf<String>()
        try {
            for (line in lines) made += langfuse.createDatasetItem(name, line.input, line.expectedOutput, line.metadata)
        } catch (error: Exception) {
            // ponytail: a best-effort take-back; one that fails too leaves its item in the set (the first failure is the one reported).
            made.forEach { runCatching { langfuse.deleteDatasetItem(it) } }
            throw error
        }
        activities.record(member, "DATASET_UPLOAD", "DATASET", name, "${made.size}건 · $fileName")
        return DatasetUploadResponse(made.size)
    }

    private fun requireName(name: String) = require(name.isNotBlank() && name.length <= NAME_MAX) { "Invalid dataset." }

    /** UTF-8 only: a lenient decode would store replacement characters in the evaluation data. */
    private fun text(file: MultipartFile): String = try {
        Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(file.bytes)).toString().removePrefix("\uFEFF")
    } catch (_: CharacterCodingException) {
        throw IllegalArgumentException("The file is not UTF-8 text.")
    }

    /** Blank lines are skipped and do not count; a line number in an error is the line's place in the file. */
    private fun parse(text: String): List<Line> {
        val filled = text.lines().withIndex().filter { it.value.isNotBlank() }
        if (filled.size > MAX_ITEMS) throw DatasetTooLargeException()
        require(filled.isNotEmpty()) { "The file has no items." }
        val errors = mutableListOf<DatasetLineError>()
        val lines = filled.mapNotNull { (index, text) ->
            try {
                line(text)
            } catch (error: IllegalArgumentException) {
                errors += DatasetLineError(index + 1, checkNotNull(error.message))
                null
            }
        }
        if (errors.isNotEmpty()) throw DatasetInvalidException(errors)
        return lines
    }

    /** The first problem of a line is its error (the same texts and rules as the screen's own check, so a file reads the same on both sides). */
    private fun line(text: String): Line {
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
        val metadata = node.get("metadata")?.takeUnless { it.isNull }
        require(metadata == null || metadata.isObject) { "metadata는 JSON 객체여야 해요." }
        return Line(input, node.get("expectedOutput")?.takeUnless { it.isNull }, metadata)
    }
}
