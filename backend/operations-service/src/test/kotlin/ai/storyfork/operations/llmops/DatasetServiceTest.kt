package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.DatasetItems
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.exception.CopyrightConfirmRequiredException
import ai.storyfork.operations._common.exception.DatasetInvalidException
import ai.storyfork.operations._common.exception.DatasetTooLargeException
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.DatasetService
import ai.storyfork.operations.llmops.service.inputHash
import ai.storyfork.operations.llmops.service.splitFor
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockMultipartFile
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked Langfuse client: no network, Spring context or database. The datasets it holds, and the items created and deleted, are recorded the way Langfuse would have seen them. */
class DatasetServiceTest {
    private val sets = mutableMapOf<String, List<JsonNode>>("my.set" to emptyList())   // the datasets Langfuse has and the items already in them
    private val created = mutableListOf<List<Any?>>()
    private val deleted = mutableListOf<String>()
    private val deleteFails = mutableSetOf<String>()
    private val reads = mutableListOf<Triple<String, Int, Int>>()   // datasetItems(name, page, limit)
    private var failOnCreate: Int? = null   // the 1-based create call that Langfuse refuses
    private var looked = false
    private val langfuse = mock(LangfuseClient::class.java, withSettings().defaultAnswer { call ->
        when (call.method.name) {
            "dataset" -> {
                val name = call.arguments[0] as String
                if (name !in sets) throw ResponseStatusException(HttpStatus.NOT_FOUND)
                looked = true
                json("""{"name":"$name"}""")
            }
            "datasetItems" -> {
                val (name, page, limit) = Triple(call.arguments[0] as String, call.arguments[1] as Int, call.arguments[2] as Int)
                reads += Triple(name, page, limit)
                val all = sets[name].orEmpty()   // a name Langfuse does not have has no items (the stubs of the read tests ask for names outside the map)
                DatasetItems(all.drop((page - 1) * limit).take(limit), all.size.toLong())
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

    private val judgeInputs = """{"character":"길동","scene":[{"by":"길동","text":"가자."}],"facts":[{"id":"f1","text":"미래 사건"}]}"""

    /** The metadata a simulation line carries: the judge inputs the rubric reads, and optionally a split and other keys. */
    private fun judged(split: String? = null, extra: String = ""): String {
        val named = if (split == null) "" else ",\"split\":\"$split\""
        return """{"judge":$judgeInputs$named$extra}"""
    }

    /** A line a general set accepts (GEval reads metadata.criteria): [n] makes its input unique. */
    private fun general(n: Int) = """{"input":{"n":$n},"expectedOutput":"답 $n","metadata":{"criteria":"기준"}}"""

    /** A line the simulation act scorer accepts (an input.data object, an expected text, the judge inputs). */
    private fun act(n: Int, metadata: String = judged()) = """{"input":{"set":"dialogue","data":{"n":$n}},"expectedOutput":"대사 $n","metadata":$metadata}"""

    /** An item as Langfuse lists it. */
    private fun stored(input: String, metadata: String = "null") = json("""{"id":"i","input":$input,"expectedOutput":"답","metadata":$metadata}""")

    private fun file(text: String, name: String = "set.jsonl") = MockMultipartFile("file", name, "application/octet-stream", text.toByteArray())

    private fun lines(vararg lines: String) = lines.joinToString("\n")

    private fun upload(text: String, confirmed: Boolean? = true, name: String = "my.set") = service.upload(operators.llm, name, file(text), confirmed)

    private fun errors(text: String, name: String = "my.set") = assertThrows(DatasetInvalidException::class.java) { upload(text, name = name) }.errors

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
    fun `the list names each set's kind and pairs a gate with its prompt, with the item count and the description`() {
        val names = listOf("qa.grounding", "simulation.act", "simulation.narrate", "extraction.extract", "optimize.simulation.act", "leak.spoiler", "optimize.foo")
        `when`(langfuse.datasets()).thenReturn(listOf(
            json("""{"id":"d0","name":"qa.grounding","description":null}"""),
            json("""{"id":"d1","name":"simulation.act","description":"인물 대사 평가"}"""),
            json("""{"id":"d2","name":"simulation.narrate","description":" "}"""),
            json("""{"id":"d3","name":"extraction.extract"}"""),
            json("""{"id":"d4","name":"optimize.simulation.act","description":"최적화 풀"}"""),
            json("""{"id":"d5","name":"leak.spoiler","description":null}"""),
            json("""{"id":"d6","name":"optimize.foo","description":null}"""),
        ))
        names.forEachIndexed { index, name -> `when`(langfuse.datasetItems(name, 1, 1)).thenReturn(DatasetItems(listOf(json("{}")), (index * 10).toLong())) }

        val sets = service.list(operators.llm)

        assertEquals(names, sets.map { it.name })
        assertEquals(listOf("gate", "gate", "gate", "gate", "pool", "general", "general"), sets.map { it.kind })   // a pool needs a gate behind it
        // The pair is the prompt that names the set as its evaluation set (the candidate gate); a pool or a set no prompt names has none.
        assertEquals(listOf("story_context.answer", "character_simulation.act", "character_simulation.narrate", "manuscript_extraction.extract", null, null, null), sets.map { it.prompt })
        assertEquals(listOf(0L, 10L, 20L, 30L, 40L, 50L, 60L), sets.map { it.itemCount })
        assertEquals(listOf(null, "인물 대사 평가", null, null, "최적화 풀", null, null), sets.map { it.description })
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
    fun `an upload creates every line in file order, skips blank lines, and is recorded with the kind and the count`() {
        val result = upload(lines(general(1), "", """{"input":{"n":2},"expectedOutput":"답 2","metadata":{"criteria":"기준","source":"x"}}""", "  ", general(3)))

        assertEquals(Triple(3, "general", null), Triple(result.created, result.kind, result.notice))
        assertEquals(listOf<List<Any?>>(
            listOf("my.set", json("""{"n":1}"""), json("\"답 1\""), json("""{"criteria":"기준"}""")),
            listOf("my.set", json("""{"n":2}"""), json("\"답 2\""), json("""{"criteria":"기준","source":"x"}""")),
            listOf("my.set", json("""{"n":3}"""), json("\"답 3\""), json("""{"criteria":"기준"}""")),
        ), created)
        // The set is checked first (a missing set is 404 and nothing is created), and the audit comes only after every item is in.
        val order = inOrder(langfuse, activities)
        order.verify(langfuse).dataset("my.set")
        order.verify(activities).record(operators.llm, "DATASET_UPLOAD", "DATASET", "my.set", "general · 3건 · set.jsonl")
    }

    @Test
    fun `a CRLF file with a byte order mark is read like any other`() {
        val text = "\uFEFF" + general(1) + "\r\n" + general(2) + "\r\n"

        assertEquals(2, upload(text).created)
    }

    @Test
    fun `every malformed line is reported with its file line number and nothing is created`() {
        val text = lines(
            general(1),                                                                           // 1
            "",                                                                                    // 2 blank
            "{not json",                                                                           // 3
            "[1,2]",                                                                               // 4
            """{"expectedOutput":"x","metadata":{"criteria":"c"}}""",                              // 5 no input
            """{"input":null,"expectedOutput":"x","metadata":{"criteria":"c"}}""",                 // 6 null input
            """{"input":{"a":1},"expected_output":"x","id":"7","metadata":{"criteria":"c"}}""",    // 7 unknown keys
            """{"input":{"a":1},"expectedOutput":"x","metadata":[1]}""",                           // 8 metadata is no object
            general(9) + " trailing",                                                              // 9 text after the JSON
            """"just text"""",                                                                     // 10
            """{"input":"q","expectedOutput":"x","metadata":{"criteria":"c"}}""",                  // 11 input is no object
            """{"input":{"a":1},"metadata":{"criteria":"c"}}""",                                   // 12 no expected output
            """{"input":{"a":1},"expectedOutput":"x"}""",                                          // 13 no criteria
            general(14),                                                                           // 14
        )

        val found = errors(text)

        assertEquals(listOf(3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13), found.map { it.line })
        assertEquals(listOf(
            "JSON으로 읽을 수 없어요.", "줄 하나가 JSON 객체여야 해요.", "input이 필요해요.", "input이 필요해요.", "알 수 없는 칸이 있어요: expected_output, id",
            "metadata는 JSON 객체여야 해요.", "JSON으로 읽을 수 없어요.", "줄 하나가 JSON 객체여야 해요.", "input은 JSON 객체여야 해요.", "expectedOutput이 필요해요.",
            "metadata.criteria가 필요해요.",
        ), found.map { it.message })
        assertNothingHappened()   // not even the set is looked up: nothing leaves this service until every line is good
    }

    @Test
    fun `the lines are checked against the scorer of the set they go to`() {
        // The same line is good for one set and bad for another: simulation.act reads the judge inputs, a general set reads criteria.
        sets["simulation.act"] = emptyList()
        val found = errors(lines(act(1), general(2), act(3, metadata = """{"criteria":"c"}""")), name = "simulation.act")

        assertEquals(listOf(2 to "input.data(객체)가 필요해요.", 3 to "metadata.judge(character·scene·facts)가 필요해요."), found.map { it.line to it.message })
        assertNothingHappened()
    }

    @Test
    fun `a request that is not a usable jsonl file is 400 before Langfuse is read`() {
        val notUtf8 = MockMultipartFile("file", "set.jsonl", null, byteArrayOf(0x7B, 0xC3.toByte(), 0x28, 0x7D))
        val bad = listOf<() -> Any?>(
            { service.upload(operators.llm, "my.set", null, true) },
            { service.upload(operators.llm, "my.set", file(general(1), "set.json"), true) },
            { service.upload(operators.llm, "my.set", file(general(1), "set.txt"), true) },
            { service.upload(operators.llm, "my.set", MockMultipartFile("file", null, "text/plain", general(1).toByteArray()), true) },
            { upload("") },
            { upload("\n  \n") },
            { service.upload(operators.llm, "my.set", notUtf8, true) },
            { upload(general(1), name = " ") },
            { upload(general(1), name = "n".repeat(201)) },
        )
        for (call in bad) assertThrows(IllegalArgumentException::class.java) { call() }

        assertNothingHappened()
        assertEquals(1, service.upload(operators.llm, "my.set", file(general(1), "SET.JSONL"), true).created)   // the extension is not case sensitive
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
        assertEquals(500, upload((List(500) { general(it) } + List(100) { "" }).joinToString("\n")).created)

        created.clear()
        assertThrows(DatasetTooLargeException::class.java) { upload(List(501) { general(it) }.joinToString("\n")) }
        // The size is looked at first, so a big file with bad lines is reported as big and not parsed line by line.
        assertThrows(DatasetTooLargeException::class.java) { upload(List(501) { "{bad" }.joinToString("\n")) }
        assertTrue(created.isEmpty())
    }

    @Test
    fun `a set Langfuse does not have is 404 and nothing is created`() {
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException::class.java) { upload(general(1), name = "no.such.set") }.statusCode)

        assertTrue(created.isEmpty())
        verifyNoInteractions(activities)
    }

    @Test
    fun `a Langfuse failure in the middle takes back what was created and records nothing`() {
        failOnCreate = 3

        val error = assertThrows(ResponseStatusException::class.java) { upload(lines(general(1), general(2), general(3), general(4))) }

        assertEquals(HttpStatus.BAD_GATEWAY, error.statusCode)
        assertEquals(listOf("item-1", "item-2"), deleted)
        verifyNoInteractions(activities)
    }

    @Test
    fun `a take-back that fails does not stop the others or hide the first failure`() {
        failOnCreate = 3
        deleteFails += "item-1"

        val error = assertThrows(ResponseStatusException::class.java) { upload(lines(general(1), general(2), general(3))) }

        assertEquals(HttpStatus.BAD_GATEWAY, error.statusCode)
        assertEquals(listOf("item-1", "item-2"), deleted)   // both were tried
        verifyNoInteractions(activities)
    }

    // ---- gate, pool and the questions they share (#868) ----

    @Test
    fun `an upload to a gate set says the baseline will be evaluated again and is recorded as a gate`() {
        sets["simulation.act"] = emptyList()
        sets["optimize.simulation.act"] = emptyList()

        val result = upload(act(1), name = "simulation.act")

        assertEquals(Triple(1, "gate", "gate 세트에 올리면 다음 평가에서 기준 버전을 다시 평가해요(비용 발생)"), Triple(result.created, result.kind, result.notice))
        verify(activities).record(operators.llm, "DATASET_UPLOAD", "DATASET", "simulation.act", "gate · 1건 · set.jsonl")
    }

    @Test
    fun `an upload to a pool is a pool upload without that notice`() {
        sets["optimize.simulation.act"] = listOf(stored("""{"set":"dialogue","data":{"x":1}}""", """{"split":"train"}"""), stored("""{"set":"dialogue","data":{"x":2}}""", """{"split":"val"}"""))
        sets["simulation.act"] = emptyList()

        val result = upload(act(1, judged("val")), name = "optimize.simulation.act")

        assertEquals(Triple(1, "pool", null), Triple(result.created, result.kind, result.notice))
        verify(activities).record(operators.llm, "DATASET_UPLOAD", "DATASET", "optimize.simulation.act", "pool · 1건 · set.jsonl")
    }

    @Test
    fun `an input that is already in the set, in its pair or twice in the file is a line error and nothing is created`() {
        sets["simulation.act"] = listOf(stored("""{"set":"dialogue","data":{"n":1}}"""))
        sets["optimize.simulation.act"] = listOf(stored("""{"data":{"n":2},"set":"dialogue"}"""))   // the same input with its keys in another order

        val found = errors(lines(act(1), act(2), act(3), act(3), act(4), act(3)), name = "simulation.act")

        assertEquals(listOf(
            1 to "이 세트에 이미 있는 input이에요.",
            2 to "짝 세트(optimize.simulation.act)에 이미 있는 input이에요. 시험 문제를 학습에 섞지 않아요.",
            4 to "파일의 3번째 줄과 input이 같아요.",
            6 to "파일의 3번째 줄과 input이 같아요.",   // every later copy points at the first one
        ), found.map { it.line to it.message })
        assertTrue(created.isEmpty())
        verifyNoInteractions(activities)
    }

    @Test
    fun `the same input with its keys in another order or spaced out is the same input`() {
        sets["my.set"] = listOf(stored("""{"b":1,"a":[1,2]}"""))

        val found = errors(lines("""{"input": {"a": [1, 2], "b": 1},"expectedOutput":"답","metadata":{"criteria":"기준"}}"""))

        assertEquals(listOf(1), found.map { it.line })
    }

    @Test
    fun `a pair that Langfuse does not have is no reason to refuse`() {
        sets["simulation.act"] = emptyList()   // optimize.simulation.act does not exist

        assertEquals(1, upload(act(1), name = "simulation.act").created)
    }

    @Test
    fun `every page of the existing items is read for the check`() {
        sets["my.set"] = List(250) { stored("""{"n":${1000 + it}}""") }

        val found = errors(lines(general(5), general(1249)))   // the last item of the third page

        assertEquals(listOf(2), found.map { it.line })
        assertEquals(listOf(Triple("my.set", 1, 100), Triple("my.set", 2, 100), Triple("my.set", 3, 100)), reads)
    }

    @Test
    fun `a pool line without a split gets the side of its input hash by the share of val items the pool already has`() {
        // 8 train and 2 val: a fifth of the pool is val.
        sets["optimize.simulation.act"] = List(8) { stored("""{"set":"dialogue","data":{"x":$it}}""", """{"split":"train"}""") } +
            List(2) { stored("""{"set":"dialogue","data":{"x":${it + 8}}}""", """{"split":"val"}""") }
        sets["simulation.act"] = emptyList()
        val inputs = (100..400).map { json("""{"set":"dialogue","data":{"n":$it}}""") }
        val toVal = inputs.first { splitFor(inputHash(it), 0.2) == "val" }
        val toTrain = inputs.first { splitFor(inputHash(it), 0.2) == "train" }
        fun line(input: JsonNode, metadata: String) = """{"input":$input,"expectedOutput":"대사","metadata":$metadata}"""
        val explicit = json("""{"set":"dialogue","data":{"n":1}}""")

        upload(lines(line(toVal, judged()), line(toTrain, judged()), line(explicit, judged("train", ",\"source\":\"x\""))), name = "optimize.simulation.act")

        // The split joins the metadata the line brought; a split the line names is kept.
        assertEquals(listOf("val", "train", "train"), created.map { (it[3] as JsonNode).get("split").stringValue() })
        assertEquals(json(judgeInputs), (created[0][3] as JsonNode).get("judge"))
        assertEquals("x", (created[2][3] as JsonNode).get("source").stringValue())
    }

    @Test
    fun `a pool without train and val items has no share, so its lines must name their split`() {
        sets["simulation.act"] = emptyList()
        // Nothing in the pool, only train items or only val items: the proportion of val is not known (none, all and "no val yet" would each be a guess).
        for (side in listOf(null, "train", "val")) {
            sets["optimize.simulation.act"] = listOfNotNull(side?.let { stored("""{"set":"dialogue","data":{"x":1}}""", """{"split":"$it"}""") })

            val found = errors(lines(act(1), act(2, judged("val")), act(3)), name = "optimize.simulation.act")

            assertEquals(listOf(1, 3), found.map { it.line }, "$side")
            assertTrue(found.all { it.message == "이 풀에는 train·val 문항이 모두 있어야 split을 자동으로 정할 수 있어요. metadata.split(train 또는 val)을 적어 주세요." })
            assertTrue(created.isEmpty())
        }

        assertEquals(1, upload(act(2, judged("val")), name = "optimize.simulation.act").created)   // a line that names its split needs no share
    }

    @Test
    fun `a split that is neither train nor val is a line error before Langfuse is read`() {
        val found = errors(act(1, judged("test")), name = "optimize.simulation.act")

        assertEquals(listOf("metadata.split은 train 또는 val이어야 해요."), found.map { it.message })
        assertNothingHappened()
    }
}
