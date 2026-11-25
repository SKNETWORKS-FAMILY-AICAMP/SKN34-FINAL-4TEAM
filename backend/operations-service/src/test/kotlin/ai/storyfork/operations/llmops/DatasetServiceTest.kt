package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.DatasetItems
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.exception.CopyrightConfirmRequiredException
import ai.storyfork.operations._common.exception.DatasetInvalidException
import ai.storyfork.operations._common.exception.DatasetTooLargeException
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.DatasetService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockMultipartFile
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException

/** Mocked Langfuse client: no network, Spring context or database. Created and deleted items are recorded the way Langfuse would have seen them. */
class DatasetServiceTest {
    private val created = mutableListOf<List<Any?>>()
    private val deleted = mutableListOf<String>()
    private val deleteFails = mutableSetOf<String>()
    private var failOnCreate: Int? = null   // the 1-based create call that Langfuse refuses
    private var missing = false
    private var looked = false
    private val langfuse = mock(LangfuseClient::class.java, withSettings().defaultAnswer { call ->
        when (call.method.name) {
            "dataset" -> {
                if (missing) throw ResponseStatusException(HttpStatus.NOT_FOUND)
                looked = true
                json("""{"name":"${call.arguments[0]}"}""")
            }
            "createDatasetItem" -> {
                check(looked) { "an item was created before the set was looked up" }
                if (created.size + 1 == failOnCreate) throw ResponseStatusException(HttpStatus.BAD_GATEWAY)
                created += call.arguments.toList()
                "item-${created.size}"
            }
            "deleteDatasetItem" -> {
                deleted += call.arguments[0] as String
                if (call.arguments[0] in deleteFails) throw ResponseStatusException(HttpStatus.BAD_GATEWAY)
                null
            }
            else -> RETURNS_DEFAULTS.answer(call)
        }
    })
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = DatasetService(operators.permissions, langfuse, activities, testMapper)

    private fun file(text: String, name: String = "set.jsonl") = MockMultipartFile("file", name, "application/octet-stream", text.toByteArray())

    private fun lines(vararg lines: String) = lines.joinToString("\n")

    private fun upload(text: String, confirmed: Boolean? = true, name: String = "my.set") = service.upload(operators.llm, name, file(text), confirmed)

    private fun assertForbidden(call: () -> Unit) {
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    private fun assertNothingHappened() {
        assertTrue(mockingDetails(langfuse).invocations.isEmpty())
        verifyNoInteractions(activities)
    }

    @Test
    fun `only an operator with the llm permission lists reads or uploads datasets`() {
        val untouched = mock(MultipartFile::class.java)
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertForbidden { service.list(denied) }
            assertForbidden { service.items(denied, "simulation.act", 1, 20) }
            assertForbidden { service.upload(denied, "simulation.act", untouched, true) }
        }

        assertNothingHappened()
        verifyNoInteractions(untouched)   // the permission is checked before any input is read
    }

    @Test
    fun `the list pairs each set with its prompt and carries the item count and the description`() {
        val names = listOf("qa.grounding", "simulation.act", "simulation.narrate", "extraction.extract", "leak.spoiler")
        `when`(langfuse.datasets()).thenReturn(listOf(
            json("""{"id":"d0","name":"qa.grounding","description":null}"""),
            json("""{"id":"d1","name":"simulation.act","description":"인물 대사 평가"}"""),
            json("""{"id":"d2","name":"simulation.narrate","description":" "}"""),
            json("""{"id":"d3","name":"extraction.extract"}"""),
            json("""{"id":"d4","name":"leak.spoiler","description":null}"""),
        ))
        names.forEachIndexed { index, name -> `when`(langfuse.datasetItems(name, 1, 1)).thenReturn(DatasetItems(listOf(json("{}")), (index * 10).toLong())) }

        val sets = service.list(operators.llm)

        assertEquals(names, sets.map { it.name })
        // The pair is the prompt that names the set as its evaluation set (the candidate gate); a set no prompt names has none.
        assertEquals(listOf("story_context.answer", "character_simulation.act", "character_simulation.narrate", "manuscript_extraction.extract", null), sets.map { it.prompt })
        assertEquals(listOf(0L, 10L, 20L, 30L, 40L), sets.map { it.itemCount })
        assertEquals(listOf(null, "인물 대사 평가", null, null, null), sets.map { it.description })
        // The item API's own total is the count, so one item per set is enough.
        for (name in names) verify(langfuse).datasetItems(name, 1, 1)
    }

    @Test
    fun `a page of items shows only the id the input the expected output and the metadata and the total`() {
        `when`(langfuse.datasetItems("simulation.act", 2, 20)).thenReturn(DatasetItems(listOf(
            json("""{"id":"i-1","status":"ACTIVE","input":{"set":"act"},"expectedOutput":"다음 글","metadata":{"source":"x"},"datasetName":"simulation.act","createdAt":"2026-11-25T00:00:00Z"}"""),
            json("""{"id":"i-2","input":"질문","expectedOutput":null,"metadata":null}"""),
        ), 57))

        val page = service.items(operators.llm, "simulation.act", 2, 20)

        assertEquals(
            json("""{"items":[{"id":"i-1","input":{"set":"act"},"expectedOutput":"다음 글","metadata":{"source":"x"}},{"id":"i-2","input":"질문","expectedOutput":null,"metadata":null}],"total":57}"""),
            json(testMapper.writeValueAsString(page)),
        )
        verify(langfuse).datasetItems("simulation.act", 2, 20)
    }

    @Test
    fun `a page number below 1 and a page size outside 1 to 100 are 400 before Langfuse is read`() {
        for ((page, size) in listOf(0 to 20, -1 to 20, 1 to 0, 1 to 101)) {
            assertThrows(IllegalArgumentException::class.java) { service.items(operators.llm, "simulation.act", page, size) }
        }
        assertThrows(IllegalArgumentException::class.java) { service.items(operators.llm, " ", 1, 20) }

        assertNothingHappened()
        `when`(langfuse.datasetItems("simulation.act", 1, 100)).thenReturn(DatasetItems(emptyList(), 0))
        service.items(operators.llm, "simulation.act", 1, 100)   // 100 is the biggest page
        verify(langfuse).datasetItems("simulation.act", 1, 100)
    }

    @Test
    fun `an upload creates every line in file order, skips blank lines, and is recorded`() {
        val result = upload(lines(
            """{"input":"첫째","expectedOutput":"답"}""", "", """{"input":{"a":1},"metadata":{"source":"x"}}""", "  ", """{"input":["셋째"],"expectedOutput":null,"metadata":null}""",
        ))

        assertEquals(3, result.created)
        assertEquals(listOf<List<Any?>>(
            listOf("my.set", json("\"첫째\""), json("\"답\""), null),
            listOf("my.set", json("""{"a":1}"""), null, json("""{"source":"x"}""")),
            listOf("my.set", json("""["셋째"]"""), null, null),
        ), created)
        // The set is checked first (a missing set is 404 and nothing is created), and the audit comes only after every item is in.
        val order = inOrder(langfuse, activities)
        order.verify(langfuse).dataset("my.set")
        order.verify(activities).record(operators.llm, "DATASET_UPLOAD", "DATASET", "my.set", "3건 · set.jsonl")
    }

    @Test
    fun `a CRLF file with a byte order mark is read like any other`() {
        val text = "\uFEFF" + """{"input":"a"}""" + "\r\n" + """{"input":"b"}""" + "\r\n"

        assertEquals(2, upload(text).created)
    }

    @Test
    fun `every malformed line is reported with its file line number and nothing is created`() {
        val text = lines(
            """{"input":"ok"}""",                                   // 1
            "",                                                     // 2 blank
            "{not json",                                            // 3
            "[1,2]",                                                // 4
            """{"expectedOutput":"x"}""",                           // 5
            """{"input":null}""",                                   // 6
            """{"input":"q","expected_output":"x","id":"7"}""",     // 7
            """{"input":"q","metadata":[1]}""",                     // 8
            """{"input":"q"} trailing""",                           // 9
            """"just text"""",                                      // 10
            """{"input":"ok"}""",                                   // 11
        )

        val errors = assertThrows(DatasetInvalidException::class.java) { upload(text) }.errors

        assertEquals(listOf(3, 4, 5, 6, 7, 8, 9, 10), errors.map { it.line })
        assertEquals(listOf(
            "JSON으로 읽을 수 없어요.", "줄 하나가 JSON 객체여야 해요.", "input이 필요해요.", "input이 필요해요.", "알 수 없는 칸이 있어요: expected_output, id",
            "metadata는 JSON 객체여야 해요.", "JSON으로 읽을 수 없어요.", "줄 하나가 JSON 객체여야 해요.",
        ), errors.map { it.message })
        assertNothingHappened()   // not even the set is looked up: nothing leaves this service until the whole file is good
    }

    @Test
    fun `a request that is not a usable jsonl file is 400 before Langfuse is read`() {
        val notUtf8 = MockMultipartFile("file", "set.jsonl", null, byteArrayOf(0x7B, 0xC3.toByte(), 0x28, 0x7D))
        val bad = listOf<() -> Any?>(
            { service.upload(operators.llm, "my.set", null, true) },
            { service.upload(operators.llm, "my.set", file("""{"input":"a"}""", "set.json"), true) },
            { service.upload(operators.llm, "my.set", file("""{"input":"a"}""", "set.txt"), true) },
            { service.upload(operators.llm, "my.set", MockMultipartFile("file", null, "text/plain", """{"input":"a"}""".toByteArray()), true) },
            { upload("") },
            { upload("\n  \n") },
            { service.upload(operators.llm, "my.set", notUtf8, true) },
            { upload("""{"input":"a"}""", name = " ") },
            { upload("""{"input":"a"}""", name = "n".repeat(201)) },
        )
        for (call in bad) assertThrows(IllegalArgumentException::class.java) { call() }

        assertNothingHappened()
        assertEquals(1, service.upload(operators.llm, "my.set", file("""{"input":"a"}""", "SET.JSONL"), true).created)   // the extension is not case sensitive
    }

    @Test
    fun `without the copyright confirmation nothing is read or created`() {
        val untouched = mock(MultipartFile::class.java)
        for (confirmed in listOf(null, false)) {
            assertThrows(CopyrightConfirmRequiredException::class.java) { service.upload(operators.llm, "my.set", untouched, confirmed) }
        }

        assertNothingHappened()
        verifyNoInteractions(untouched)
    }

    @Test
    fun `a file may have 500 items and blank lines do not count, the 501st is too large`() {
        val item = """{"input":"a"}"""

        assertEquals(500, upload((List(500) { item } + List(100) { "" }).joinToString("\n")).created)

        created.clear()
        assertThrows(DatasetTooLargeException::class.java) { upload(List(501) { item }.joinToString("\n")) }
        // The size is looked at first, so a big file with bad lines is reported as big and not parsed line by line.
        assertThrows(DatasetTooLargeException::class.java) { upload(List(501) { "{bad" }.joinToString("\n")) }
        assertTrue(created.isEmpty())
    }

    @Test
    fun `a set Langfuse does not have is 404 and nothing is created`() {
        missing = true

        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException::class.java) { upload("""{"input":"a"}""") }.statusCode)

        assertTrue(created.isEmpty())
        verifyNoInteractions(activities)
    }

    @Test
    fun `a Langfuse failure in the middle takes back what was created and records nothing`() {
        failOnCreate = 3

        val error = assertThrows(ResponseStatusException::class.java) { upload(lines("""{"input":1}""", """{"input":2}""", """{"input":3}""", """{"input":4}""")) }

        assertEquals(HttpStatus.BAD_GATEWAY, error.statusCode)
        assertEquals(listOf("item-1", "item-2"), deleted)
        verifyNoInteractions(activities)
    }

    @Test
    fun `a take-back that fails does not stop the others or hide the first failure`() {
        failOnCreate = 3
        deleteFails += "item-1"

        val error = assertThrows(ResponseStatusException::class.java) { upload(lines("""{"input":1}""", """{"input":2}""", """{"input":3}""")) }

        assertEquals(HttpStatus.BAD_GATEWAY, error.statusCode)
        assertEquals(listOf("item-1", "item-2"), deleted)   // both were tried
        verifyNoInteractions(activities)
    }
}
