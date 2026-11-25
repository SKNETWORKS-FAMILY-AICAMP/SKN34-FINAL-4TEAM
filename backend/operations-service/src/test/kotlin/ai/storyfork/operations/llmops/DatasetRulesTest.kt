package ai.storyfork.operations.llmops

import ai.storyfork.operations.llmops.service.datasetKind
import ai.storyfork.operations.llmops.service.inputHash
import ai.storyfork.operations.llmops.service.lineProblem
import ai.storyfork.operations.llmops.service.pairedDataset
import ai.storyfork.operations.llmops.service.splitFor
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode

/** 세트 이름으로 정하는 것(종류·짝)과 채점기가 읽는 칸(세트별 필수)을 AI 서비스의 채점 코드와 실제 seed 항목에 맞춰 고정한다. */
class DatasetRulesTest {
    private fun problem(dataset: String, input: String, expected: String? = "\"답\"", metadata: String? = null) =
        lineProblem(dataset, json(input), expected?.let(::json), metadata?.let(::json))

    private val judge = """{"judge":{"character":"길동","scene":[{"by":"길동","text":"\"가자.\""}],"facts":[{"id":"f1","text":"미래 사건"}]}}"""
    private val act = """{"set":"dialogue","data":{"self":{"id":"c1"}}}"""

    @Test
    fun `a prompt's evaluation set is a gate, optimize dot a gate is its pool and every other name is general`() {
        for (gate in listOf("qa.grounding", "simulation.act", "simulation.narrate", "decision_guard.routing", "extraction.extract")) {
            assertEquals("gate", datasetKind(gate), gate)
            assertEquals("optimize.$gate", pairedDataset(gate))
            assertEquals("pool", datasetKind("optimize.$gate"), gate)
            assertEquals(gate, pairedDataset("optimize.$gate"))
        }
        // The pool needs a gate behind it: optimize.<anything else> and the sets no prompt names are general and have no pair.
        for (general in listOf("leak.spoiler", "world.conflict", "my.set", "optimize.foo", "optimize.", "optimize.optimize.simulation.act", "Simulation.act", "qa.mine")) {
            assertEquals("general", datasetKind(general), general)
            assertNull(pairedDataset(general), general)
        }
    }

    @Test
    fun `every item of every seed set and pool is accepted for its own set`() {
        // The rules are read from the scorers, so the real items of the repository must pass them: a rule stricter than reality would refuse a legal upload.
        val root = Path.of("..", "ai-service", "app", "evaluation", "datasets")
        val files = Files.list(root).use { it.filter { path -> path.toString().endsWith(".jsonl") }.toList() } +
            Files.list(root.resolve("optimize")).use { it.filter { path -> path.toString().endsWith(".jsonl") }.toList() }
        assertEquals(11, files.size)   // 8 sets and 3 pools
        for (path in files) {
            val name = path.fileName.toString().removeSuffix(".jsonl").let { if (path.parent.fileName.toString() == "optimize") "optimize.$it" else it }
            val rows = Files.readAllLines(path).filter { it.isNotBlank() }.map(::json)
            assertTrue(rows.isNotEmpty(), name)
            for (row in rows) assertNull(lineProblem(name, row.get("input"), row.get("expectedOutput"), row.get("metadata")), name + " " + row.get("id"))
        }
    }

    @Test
    fun `every set needs an object input and an expected output that is not empty`() {
        for (dataset in listOf("my.set", "qa.grounding", "simulation.act", "extraction.extract")) {
            assertEquals("input은 JSON 객체여야 해요.", problem(dataset, "\"글\""), dataset)
            assertEquals("input은 JSON 객체여야 해요.", problem(dataset, "[1]"), dataset)
        }
        val criteria = """{"criteria":"기준"}"""
        assertNull(problem("my.set", """{"a":1}""", "\"답\"", criteria))
        for (empty in listOf(null, "null", "\"\"", "\"  \"", "{}", "[]")) {
            assertEquals("expectedOutput이 필요해요.", problem("my.set", """{"a":1}""", empty, criteria), "$empty")
        }
        assertEquals("expectedOutput은 글이어야 해요.", problem("my.set", """{"a":1}""", "3", criteria))
        assertEquals("expectedOutput은 글이어야 해요.", problem("my.set", """{"a":1}""", """{"x":1}""", criteria))
    }

    @Test
    fun `a set that is scored by GEval needs metadata criteria`() {
        for (bad in listOf(null, "{}", """{"criteria":""}""", """{"criteria":" "}""", """{"criteria":3}""")) {
            assertEquals("metadata.criteria가 필요해요.", problem("world.conflict", """{"a":1}""", "\"답\"", bad), "$bad")
        }
        assertNull(problem("world.conflict", """{"a":1}""", "\"답\"", """{"criteria":"충돌 지점을 짚으면 높은 점수"}"""))
        // The scorer is picked by the name like the evaluation service does it (qa. prefix: Ragas), so simulation.foo is a GEval set too.
        assertEquals("metadata.criteria가 필요해요.", problem("simulation.foo", act, "\"답\"", judge))
    }

    @Test
    fun `a qa set needs the question and the contexts the Ragas scorer reads`() {
        val ok = """{"question":"누구인가?","contexts":["길동은 서자다."]}"""
        assertNull(problem("qa.grounding", ok))
        assertNull(problem("qa.mine", ok))   // the qa. prefix picks the scorer, not the gate list
        assertNull(problem("optimize.qa.grounding", ok))
        for (bad in listOf("""{"contexts":["문맥"]}""", """{"question":" ","contexts":["문맥"]}""", """{"question":3,"contexts":["문맥"]}""")) {
            assertEquals("input.question이 필요해요.", problem("qa.grounding", bad), bad)
        }
        for (bad in listOf("""{"question":"질문"}""", """{"question":"질문","contexts":[]}""", """{"question":"질문","contexts":"문맥"}""",
            """{"question":"질문","contexts":["문맥",3]}""", """{"question":"질문","contexts":["문맥"," "]}""")) {
            assertEquals("input.contexts(글 목록)가 필요해요.", problem("qa.grounding", bad), bad)
        }
        assertEquals("expectedOutput은 글이어야 해요.", problem("qa.grounding", ok, """{"a":1}"""))
    }

    @Test
    fun `a simulation set needs input data, an expected text and the judge inputs the rubric reads`() {
        for (dataset in listOf("simulation.act", "optimize.simulation.act")) {
            assertNull(problem(dataset, act, "\"가자.\"", judge), dataset)
            assertEquals("input.data(객체)가 필요해요.", problem(dataset, """{"set":"dialogue"}""", "\"가자.\"", judge))
            assertEquals("input.data(객체)가 필요해요.", problem(dataset, """{"set":"dialogue","data":"글"}""", "\"가자.\"", judge))
            assertEquals("expectedOutput은 글이어야 해요.", problem(dataset, act, """{"a":1}""", judge))
            assertEquals("metadata.judge(character·scene·facts)가 필요해요.", problem(dataset, act, "\"가자.\"", null))
        }
        // What the rubric reads: character text (empty is fine for a narration), scene lines {by, text}, facts {id, text}.
        for (bad in listOf("""{"judge":"x"}""", """{"judge":{"scene":[],"facts":[]}}""", """{"judge":{"character":3,"scene":[],"facts":[]}}""",
            """{"judge":{"character":"길동","facts":[]}}""", """{"judge":{"character":"길동","scene":{"by":"a"},"facts":[]}}""",
            """{"judge":{"character":"길동","scene":[{"by":"길동"}],"facts":[]}}""", """{"judge":{"character":"길동","scene":[{"by":"길동","text":3}],"facts":[]}}""",
            """{"judge":{"character":"길동","scene":[]}}""", """{"judge":{"character":"길동","scene":[],"facts":[{"id":"f1"}]}}""",
            """{"judge":{"character":"길동","scene":[],"facts":[{"id":1,"text":"사실"}]}}""")) {
            assertEquals("metadata.judge(character·scene·facts)가 필요해요.", problem("simulation.act", act, "\"가자.\"", bad), bad)
        }
        assertNull(problem("simulation.act", act, "\"가자.\"", """{"judge":{"character":"","scene":[],"facts":[]}}"""))   // empty lists and an empty character are what the scorer accepts
    }

    @Test
    fun `a narration set also needs input set narration or monologue`() {
        for (dataset in listOf("simulation.narrate", "optimize.simulation.narrate")) {
            for (set in listOf("narration", "monologue")) assertNull(problem(dataset, """{"set":"$set","data":{"a":1}}""", "\"다음 글\"", judge), dataset)
            for (bad in listOf("""{"data":{"a":1}}""", """{"set":"dialogue","data":{"a":1}}""", """{"set":3,"data":{"a":1}}""")) {
                assertEquals("input.set은 narration 또는 monologue여야 해요.", problem(dataset, bad, "\"다음 글\"", judge), bad)
            }
        }
        assertNull(problem("simulation.act", """{"set":"anything","data":{"a":1}}""", "\"가자.\"", judge))   // the act call does not read input.set
    }

    @Test
    fun `a routing set needs the request and the answer the guard scorer compares`() {
        val answer = """{"guard":"none","capabilities":["story_context"]}"""
        val turn = """{"request":"다음 화에 넣을 사건을 추천해줘","reply":"사건 세 개를 제안했어요.","features":["writing_editing"]}"""
        assertNull(problem("decision_guard.routing", """{"request":"카엘의 목표가 뭐였지?"}""", answer))
        assertNull(problem("decision_guard.routing", """{"request":"응, 3화로 해줘","history":[$turn]}""", answer))   // the turns are sent to the guard as they are, so only a list is checked
        assertNull(problem("decision_guard.routing", """{"request":"안녕","history":[]}""", """{"guard":"none","capabilities":[]}"""))   // a chat message picks no feature and a refusal picks none either
        assertNull(problem("decision_guard.routing", """{"request":"질문"}""", answer, """{"case":"single"}"""))   // nothing in metadata is read
        for (bad in listOf("""{"history":[]}""", """{"request":""}""", """{"request":"  "}""", """{"request":3}""", """{"request":null}""")) {
            assertEquals("input.request가 필요해요.", problem("decision_guard.routing", bad, answer), bad)
        }
        // history is read as `item_input.get('history', [])` and must be a list: a key that is there as null, text or an object fails the item.
        for (bad in listOf("""{"request":"질문","history":null}""", """{"request":"질문","history":"이전"}""", """{"request":"질문","history":{"request":"x"}}""")) {
            assertEquals("input.history는 목록이어야 해요.", problem("decision_guard.routing", bad, answer), bad)
        }
        for (bad in listOf("\"none\"", "[1]", """{"guard":"none"}""", """{"capabilities":[]}""", """{"guard":1,"capabilities":[]}""", """{"guard":"none","capabilities":"story_context"}""",
            """{"guard":"none","capabilities":[1]}""", """{"guard":"none","capabilities":[{"a":1}]}""")) {
            assertEquals("expectedOutput이 정답(guard·capabilities) 모양이 아니에요.", problem("decision_guard.routing", """{"request":"질문"}""", bad), bad)
        }
        assertEquals("expectedOutput이 필요해요.", problem("decision_guard.routing", """{"request":"질문"}""", "{}"))   // an empty answer is no answer, like for every set
    }

    private val body = "길동은 칼을 들었다. 칼은 무거웠다. 홍문이 보았다."
    private val episode = """{"number":3,"title":"3화","body":"$body"}"""
    private fun gold(mentions: String = "", statements: String = "", relationships: String = "") =
        """{"mentions":[$mentions],"statements":[$statements],"relationships":[$relationships]}"""
    private fun mention(name: String, kind: String, core: Boolean = true, aliases: String = "") = """{"name":"$name","kind":"$kind","aliases":[$aliases],"core":$core}"""
    private fun statement(document: String, core: Boolean = true) = """{"kind":"fact","document":"$document","quote":"길동은 칼을 들었다.","core":$core}"""
    private fun relation(source: String, target: String, core: Boolean = true) = """{"source":"$source","target":"$target","label":"아버지","core":$core}"""

    @Test
    fun `an extraction set needs the episode input and a gold table with at least one core answer that counts as a setting`() {
        val character = gold(mentions = mention("길동", "character"))
        for (dataset in listOf("extraction.extract", "optimize.extraction.extract")) {
            assertNull(problem(dataset, episode, character), dataset)
            assertEquals("expectedOutput이 필요해요.", problem(dataset, episode, "null"))
        }
        for (bad in listOf("""{"title":"3화","body":"글"}""", """{"number":0,"title":"3화","body":"글"}""", """{"number":1.5,"title":"3화","body":"글"}""",
            """{"number":"3","title":"3화","body":"글"}""", """{"number":true,"title":"3화","body":"글"}""", """{"number":3,"body":"글"}""",
            """{"number":3,"title":"3화"}""", """{"number":3,"title":3,"body":"글"}""", """{"number":3,"title":"3화","body":null}""")) {
            assertEquals("input에는 number(1 이상 정수)·title·body가 필요해요.", problem("extraction.extract", bad, character), bad)
        }
        assertNull(problem("extraction.extract", """{"number":3,"title":"3화","body":"글","extra":1}""", character))   // EpisodeText ignores unknown keys
    }

    @Test
    fun `the gold table must have the shape the scorer parses`() {
        val ok = mention("길동", "character")
        for (bad in listOf("\"표\"", "[1]", """{"mentions":[],"statements":[]}""", """{"mentions":{},"statements":[],"relationships":[]}""",
            gold(mentions = """{"kind":"character","aliases":[],"core":true}"""),                       // name missing
            gold(mentions = """{"name":"길동","aliases":[],"core":true}"""),                            // kind missing
            gold(mentions = """{"name":"길동","kind":"character","core":true}"""),                      // aliases missing
            gold(mentions = """{"name":"길동","kind":"character","aliases":[1],"core":true}"""),         // aliases of non-text
            gold(mentions = """{"name":"길동","kind":"character","aliases":[],"core":"true"}"""),        // core must be a real boolean
            gold(mentions = ok, statements = """{"kind":"fact","quote":"q","core":true}"""),           // document missing
            gold(mentions = ok, statements = """{"kind":"fact","document":"identity","core":true}"""),  // quote missing
            gold(mentions = ok, relationships = """{"source":"길동","target":"홍문","core":true}"""),     // label missing
            gold(mentions = ok, relationships = """{"source":"길동","label":"아버지","core":true}"""))) { // target missing
            assertEquals("expectedOutput이 정답표(mentions·statements·relationships) 모양이 아니에요.", problem("extraction.extract", episode, bad), bad)
        }
        assertNull(problem("extraction.extract", episode, gold(mentions = ok, statements = "", relationships = "")))   // empty lists are a table too
    }

    @Test
    fun `the core answer that counts is a setting like the scorer partitions it`() {
        val none = "정답표에 설정에 드는 core 정답이 하나 이상 있어야 해요."
        fun check(table: String) = problem("extraction.extract", episode, table)

        assertEquals(none, check(gold()))                                                                                  // nothing at all
        assertEquals(none, check(gold(mentions = mention("길동", "character", core = false))))                              // not core
        assertEquals(none, check(gold(mentions = mention("홍문", "object"))))                                              // an object seen once (body has 홍문 once) is no setting
        assertNull(check(gold(mentions = mention("칼", "object"))))                                                         // seen twice in the body
        assertNull(check(gold(mentions = mention("검", "object", aliases = "\"칼\""))))                                     // the most seen name or alias counts
        assertEquals(none, check(gold(statements = statement("memory"))))                                                  // a plot event is no setting
        for (document in listOf("identity", "soul", "goal")) assertNull(check(gold(statements = statement(document))), document)
        assertEquals(none, check(gold(statements = statement("identity", core = false))))
        // A relation counts when both ends are settings (a mention that is not an object, or an object seen twice) and one end is a character.
        val ends = mention("길동", "character", core = false) + "," + mention("홍문", "character", core = false)
        assertNull(check(gold(mentions = ends, relationships = relation("길동", "홍문"))))
        assertEquals(none, check(gold(mentions = ends, relationships = relation("길동", "홍문", core = false))))
        assertEquals(none, check(gold(mentions = mention("길동", "character", core = false), relationships = relation("길동", "홍문"))))        // an end that is no mention
        assertEquals(none, check(gold(mentions = mention("길동", "character", core = false) + "," + mention("홍문", "object", core = false), relationships = relation("길동", "홍문"))))   // 홍문 as an object seen once
        assertEquals(none, check(gold(mentions = mention("칼", "object", core = false) + "," + mention("책", "location", core = false), relationships = relation("칼", "책"))))   // no character end
        assertNull(check(gold(mentions = mention("칼", "object", core = false) + "," + mention("길동", "character", core = false), relationships = relation("길동", "칼"))))
    }

    @Test
    fun `a name is counted in the episode the way the scorer counts it`() {
        fun check(body: String, name: String) = problem("extraction.extract", """{"number":3,"title":"3화","body":"$body"}""", gold(mentions = mention(name, "object")))
        val none = "정답표에 설정에 드는 core 정답이 하나 이상 있어야 해요."

        assertEquals(none, check("가가가", "가가"))   // hits that overlap are one hit (Python's str.count), not two
        assertNull(check("가가 가가", "가가"))
        assertNull(check("글", ""))   // an empty name is found once more than the text has characters, so twice here
        assertNull(check("a.b a.b", "a.b"))   // the name is text, not a pattern
        assertEquals(none, check("axb ayb", "a.b"))   // a pattern would find it twice
    }

    @Test
    fun `the split of a pool item is train or val and a gate or general set has no split to check`() {
        val base = """{"judge":{"character":"","scene":[],"facts":[]},"split":"SPLIT"}"""
        for (good in listOf("train", "val")) assertNull(problem("optimize.simulation.act", act, "\"가자.\"", base.replace("SPLIT", good)), good)
        for (bad in listOf("test", "Train", "", "1")) {
            assertEquals("metadata.split은 train 또는 val이어야 해요.", problem("optimize.simulation.act", act, "\"가자.\"", base.replace("SPLIT", bad)), bad)
        }
        assertEquals("metadata.split은 train 또는 val이어야 해요.", problem("optimize.simulation.act", act, "\"가자.\"", """{"judge":{"character":"","scene":[],"facts":[]},"split":3}"""))
        assertNull(problem("optimize.simulation.act", act, "\"가자.\"", judge))   // no split yet: the upload assigns it
        assertNull(problem("simulation.act", act, "\"가자.\"", base.replace("SPLIT", "whatever")))   // a gate set does not use it
    }

    @Test
    fun `the same input has the same hash whatever the key order or spacing`() {
        val a = inputHash(json("""{"b":1,"a":[1,2,{"y":true,"x":null}]}"""))

        assertEquals(a, inputHash(json("""{ "a" : [1, 2, {"x":null, "y":true}], "b" : 1 }""")))
        assertEquals(64, a.length)
        assertTrue(a.all { it in "0123456789abcdef" })
        for (other in listOf("""{"b":1,"a":[2,1,{"y":true,"x":null}]}""", """{"b":2,"a":[1,2,{"y":true,"x":null}]}""", """{"b":1,"a":[1,2,{"y":true,"x":0}]}""", """"{}"""", """[]""")) {
            assertNotEquals(a, inputHash(json(other)), other)   // an array keeps its order, and a text is not the object it spells
        }
        assertNotEquals(inputHash(json("\"1\"")), inputHash(json("1")))
    }

    @Test
    fun `a float hashes the way Langfuse stores it, so the digits it drops and 1 point 0 against 1 make no difference but a text stays a text`() {
        // Langfuse keeps 16 digits of a float: 0.38461538461538464 is read back as 0.3846153846153846 and 1.0 as 1.
        val a = inputHash(json("""{"x":0.38461538461538464,"y":[1.0,{"z":2.5}],"n":1}"""))

        assertEquals(a, inputHash(json("""{"x":0.3846153846153846,"y":[1,{"z":2.50}],"n":1.0}""")))
        for (other in listOf("""{"x":0.3846153,"y":[1.0,{"z":2.5}],"n":1}""", """{"x":0.38461538461538464,"y":[1.0,{"z":2.6}],"n":1}""", """{"x":0.38461538461538464,"y":[1.0,{"z":2.5}],"n":2}""")) {
            assertNotEquals(a, inputHash(json(other)), other)   // seven digits, 2.6 and 2 are other numbers
        }
        assertNotEquals(inputHash(json("""{"n":12345678901234567}""")), inputHash(json("""{"n":12345678901234568}""")))   // an integer keeps every digit
        assertNotEquals(inputHash(json("""{"q":"1.0"}""")), inputHash(json("""{"q":"1"}""")))   // a text is not read as a number
        assertNotEquals(inputHash(json("""{"q":"\"가자.\""}""")), inputHash(json("""{"q":"가자."}""")))   // and its quotes stay: Langfuse leaves a text inside an object as it is
    }

    @Test
    fun `the split is val below the share of the first 32 bits of the hash and train from there`() {
        fun hash(top: String) = top + "0".repeat(56)

        assertEquals("val", splitFor(hash("00000000"), 0.2))
        assertEquals("val", splitFor(hash("33333333"), 0.2))     // 0x33333333 / 2^32 = 0.19999999982
        assertEquals("train", splitFor(hash("33333334"), 0.2))   // 0.20000000019
        assertEquals("train", splitFor(hash("ffffffff"), 0.99))
        assertEquals("val", splitFor(hash("ffffffff"), 1.0))
        assertEquals("train", splitFor(hash("00000000"), 0.0))
    }
}
