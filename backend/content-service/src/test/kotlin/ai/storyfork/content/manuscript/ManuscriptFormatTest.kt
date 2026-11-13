package ai.storyfork.content.manuscript

import ai.storyfork.content.manuscript.domain.ManuscriptFormat
import ai.storyfork.content.manuscript.domain.ManuscriptFormat.Kind
import ai.storyfork.content.manuscript.domain.ManuscriptFormat.Kind.*
import java.time.Duration
import kotlin.random.Random
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.assertTimeout

/** 원고 기본 서식 계약(DEC-48, docs/design/manuscript-format-contract.md)의 문법 검사. 검증 표는 프런트(TypeScript)가 같은 행을 따로 검사한다. */
class ManuscriptFormatTest {
    private val id = "11111111-2222-3333-4444-555555555555"

    /** 검증 표의 "내용" 표기. `B{…}` = 굵게, `I{…}` = 기울임. */
    private fun drawn(content: String) = ManuscriptFormat.inline(content, { it }, { "B{$it}" }, { "I{$it}" })
    private fun row(line: String, kind: Kind, content: String = "") = Triple(line, kind, content)
    private fun check(rows: List<Triple<String, Kind, String>>) = rows.mapIndexed { index, (input, kind, content) ->
        dynamicTest("${index + 1}. ${input.take(40)}") {
            val line = ManuscriptFormat.line(input)
            assertEquals(kind to content, line.kind to if (line.kind == IMAGE) line.content else drawn(line.content))
        }
    }

    // 보이지 않는 글자는 소스에 그대로 두지 않고 코드로 만든다.
    private fun char(code: Int) = Char(code).toString()

    @TestFactory fun `contract verification table`() = check(listOf(
        row("비가 그친 새벽이었다.", PARAGRAPH, "비가 그친 새벽이었다."),
        row("**그는 돌아오지 않았다.**", PARAGRAPH, "B{그는 돌아오지 않았다.}"),
        row("그는 *분명히* 말했다.", PARAGRAPH, "그는 I{분명히} 말했다."),
        row("***끝***", PARAGRAPH, "B{I{끝}}"),
        row("**굵게 *둘 다* 굵게**", PARAGRAPH, "B{굵게 I{둘 다} 굵게}"),
        row("2 * 3 * 4", PARAGRAPH, "2 * 3 * 4"),
        row("**짝 없음", PARAGRAPH, "**짝 없음"),
        row("별표 \\*글자\\*", PARAGRAPH, "별표 *글자*"),
        row("** 공백 **", PARAGRAPH, "** 공백 **"),
        row("## 1장 새벽", HEADING, "1장 새벽"),
        row("# **굵은** 제목", HEADING, "B{굵은} 제목"),
        row("#태그", PARAGRAPH, "#태그"),
        row("## ", PARAGRAPH, "## "),
        row("\\# 소제목 아님", PARAGRAPH, "# 소제목 아님"),
        row("> 그가 말했다.", QUOTE, "그가 말했다."),
        row(">붙여 쓴 인용", QUOTE, "붙여 쓴 인용"),
        row(">", QUOTE),
        row("---", DIVIDER),
        row("*****", DIVIDER),
        row("--", PARAGRAPH, "--"),
        row(" ---", PARAGRAPH, " ---"),
        row("[[image:$id]]", IMAGE, id),
        row("앞 [[image:$id]]", PARAGRAPH, "앞 [[image:$id]]"),
        row("- 목록 아님", PARAGRAPH, "- 목록 아님"),
        row("1. 목록 아님", PARAGRAPH, "1. 목록 아님"),
        row("`코드 아님`", PARAGRAPH, "`코드 아님`"),
        row("<b>태그 아님</b>", PARAGRAPH, "<b>태그 아님</b>"),
        row("*a**b**c*", PARAGRAPH, "I{aB{b}c}"),
        row("**a** **b**", PARAGRAPH, "B{a} B{b}"),
        row("*기울임*과 **굵게**", PARAGRAPH, "I{기울임}과 B{굵게}"),
        row("**a***", PARAGRAPH, "B{a*}"),
        row("a*b*c", PARAGRAPH, "aI{b}c"),
        row("끝에 별표*", PARAGRAPH, "끝에 별표*"),
        row("**${char(0x3000)}전각 공백**", PARAGRAPH, "**${char(0x3000)}전각 공백**"),
        row("\\---", PARAGRAPH, "---"),
        row("> \\# 가", QUOTE, "\\# 가"),
        row("\\\\*가", PARAGRAPH, "\\*가"),
        row("**" + "가".repeat(1996) + "**", PARAGRAPH, "B{" + "가".repeat(1996) + "}"),
        row("**" + "가".repeat(1997) + "**", PARAGRAPH, "**" + "가".repeat(1997) + "**"),
        row("[[image:AAAAAAAA-2222-3333-4444-555555555555]]", IMAGE, "AAAAAAAA-2222-3333-4444-555555555555"),
        row("\\> 인용 아님", PARAGRAPH, "> 인용 아님"),
        row("***", DIVIDER),
    ))

    /** 검증 표에는 없지만 문법 표와 "줄 안의 서식" 문장이 정한 경계. */
    @TestFactory fun `grammar edges the table leaves out`() = check(listOf(
        row("", BLANK),
        row("   ", PARAGRAPH, "   "),
        row("###### 여섯 개", HEADING, "여섯 개"),
        row("####### 일곱 개", PARAGRAPH, "####### 일곱 개"),
        row("##  두 칸 ", HEADING, " 두 칸 "),
        row("> ", QUOTE),
        row(">  두 칸", QUOTE, " 두 칸"),
        row("> > 겹친 인용 아님", QUOTE, "> 겹친 인용 아님"),
        row("> ## 인용 안의 기호", QUOTE, "## 인용 안의 기호"),
        row("----------", DIVIDER),
        row("--- ", PARAGRAPH, "--- "),
        row("--*", PARAGRAPH, "--*"),
        row("- - -", PARAGRAPH, "- - -"),
        row("[[IMAGE:$id]]", PARAGRAPH, "[[IMAGE:$id]]"),
        row("[[image:not-a-uuid]]", PARAGRAPH, "[[image:not-a-uuid]]"),
        row("[[image:$id]] ", PARAGRAPH, "[[image:$id]] "),
        row("\\- 목록 아님", PARAGRAPH, "- 목록 아님"),
        row("\\*\\*\\*", PARAGRAPH, "***"),
        row(" \\# 줄 맨 앞이 아님", PARAGRAPH, " \\# 줄 맨 앞이 아님"),
        row("역슬래시 \\ 는 \\n 그대로", PARAGRAPH, "역슬래시 \\ 는 \\n 그대로"),
        row("\\**a**", PARAGRAPH, "**a**"),
        row("**a\\**", PARAGRAPH, "**a**"),
        row("**a\\*b**", PARAGRAPH, "B{a*b}"),
        row("*a* *b", PARAGRAPH, "I{a} *b"),
        row("****", DIVIDER),
        row("**** 넷", PARAGRAPH, "**** 넷"),
        // 길이 상한은 줄이 아니라 내용(줄 종류 기호를 뗀 글)의 UTF-16 길이로 재고, 넘으면 굵게·기울임과 \* 를 글자 그대로 둔다.
        // 줄 종류 판정과 문단 줄 맨 앞의 백슬래시 떼기는 길이와 상관없이 그대로다.
        row("## **" + "가".repeat(1996) + "**", HEADING, "B{" + "가".repeat(1996) + "}"),
        row("## **굵게** " + "가".repeat(1994), HEADING, "**굵게** " + "가".repeat(1994)),
        row("\\*별표 " + "가".repeat(1996), PARAGRAPH, "\\*별표 " + "가".repeat(1996)),
        row("\\#" + "가".repeat(2000), PARAGRAPH, "#" + "가".repeat(2000)),
        row("**" + Character.toString(0x1F600).repeat(999) + "**", PARAGRAPH, "**" + Character.toString(0x1F600).repeat(999) + "**"),
    ))

    @Test fun `spaces are exactly the characters a JavaScript regular expression calls whitespace`() {
        val spaces = listOf(0x09..0x0D, 0x20..0x20, 0xA0..0xA0, 0x1680..0x1680, 0x2000..0x200A, 0x2028..0x2029, 0x202F..0x202F, 0x205F..0x205F, 0x3000..0x3000, 0xFEFF..0xFEFF).flatten()
        for (space in spaces.map(::char)) {
            val name = "U+%04X".format(space[0].code)
            assertEquals("**${space}글**", drawn("**${space}글**"), name)
            assertEquals("**글${space}**", drawn("**글${space}**"), name)
            assertEquals("*${space}글*", drawn("*${space}글*"), name)
            assertEquals("*글${space}*", drawn("*글${space}*"), name)
            assertEquals(PARAGRAPH, ManuscriptFormat.line("## $space").kind, name)
        }
        // JavaScript의 \s 에 없는 글자다. Java의 (?U)\s 는 U+0085를 공백으로 보고 U+FEFF를 공백으로 보지 않아 그대로 쓰면 프런트와 어긋난다.
        for (other in listOf(0x85, 0x200B, 0x180E).map(::char)) {
            val name = "U+%04X".format(other[0].code)
            assertEquals("B{${other}글${other}}", drawn("**${other}글${other}**"), name)
            assertEquals("I{${other}글${other}}", drawn("*${other}글${other}*"), name)
            assertEquals(HEADING, ManuscriptFormat.line("## $other").kind, name)
        }
    }

    @Test fun `formatting closes only inside one line with the line breaks JavaScript knows`() {
        for (breaker in listOf(0x0A, 0x0D, 0x2028, 0x2029).map(::char)) {
            val name = "U+%04X".format(breaker[0].code)
            assertEquals("**a${breaker}b**", drawn("**a${breaker}b**"), name)
            assertEquals("*a${breaker}b*", drawn("*a${breaker}b*"), name)
            assertEquals(listOf(PARAGRAPH, PARAGRAPH, PARAGRAPH), listOf("## a${breaker}b", "> a${breaker}b", "---$breaker").map { ManuscriptFormat.line(it).kind }, name)
        }
        // U+0085는 JavaScript에서 줄바꿈이 아니다(Java의 . 은 건너지 못한다).
        assertEquals("B{a${char(0x85)}b}", drawn("**a${char(0x85)}b**"))
        assertEquals(listOf(HEADING, QUOTE), listOf("## a${char(0x85)}b", "> a${char(0x85)}b").map { ManuscriptFormat.line(it).kind })
    }

    // 스캐너의 기준(oracle): 계약의 두 정규식을 그대로 되풀이해 찾는 구현이다(스캐너로 바꾸기 전의 ManuscriptFormat.inline).
    // 글자 집합은 JavaScript의 \s·. 과 같고, 안쪽은 따로 뗀 문자열로 다시 해석한다.
    private val space = "\\t\\n\\x0B\\f\\r \\xA0\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}"
    private val any = "[^\\n\\r\\x{2028}\\x{2029}]"
    private val boldPattern = Regex("(?<!\\\\)\\*\\*(?=[^$space])($any+?)(?<=[^$space])(?<!\\\\)\\*\\*(?!\\*)")
    private val italicPattern = Regex("(?<![\\\\*])\\*(?=[^$space*])($any+?)(?<=[^$space*])(?<!\\\\)\\*(?!\\*)")
    private fun oracle(content: String): String {
        if (content.length > 2000) return content
        val out = StringBuilder()
        var from = 0
        while (true) {
            val strong = boldPattern.find(content, from)
            val emphasis = italicPattern.find(content, from)
            val isBold = strong != null && (emphasis == null || strong.range.first <= emphasis.range.first)
            val match = (if (isBold) strong else emphasis) ?: break
            out.append(content.substring(from, match.range.first).replace("\\*", "*"))
            val inner = oracle(match.groupValues[1])
            out.append(if (isBold) "B{$inner}" else "I{$inner}")
            from = match.range.last + 1
        }
        return out.append(content.substring(from).replace("\\*", "*")).toString()
    }

    @Test fun `the scanner draws every line exactly like the regular expressions of the contract`() {
        val random = Random(20261112)
        // 기호·공백·백슬래시·전각 공백·줄바꿈 글자·짝 없는 서로게이트가 섞인 줄.
        val symbols = listOf("*", "*", "*", "*", "**", "***", "\\", "\\*", " ", " ", "a", "b", "글", "자", "#", ">", "-", "<", "&", "\t", "\n", "\r") +
            listOf(0x3000, 0xA0, 0xFEFF, 0x85, 0x200B, 0x2028, 0x2029, 0xD83D, 0xDE00).map(::char) + Character.toString(0x1F600)
        // 줄바꿈 글자 없이 별표가 많은 줄. 멀리 떨어진 기호끼리 맞는다.
        val stars = listOf("*", "*", "*", "**", "***", "\\", "\\*", " ", " ", "a", "글", char(0x3000))
        // 글자가 대부분이고 서식이 드문 보통 문단.
        val prose = listOf("가", "나", "다", "라", " ", " ", "가나다 ", "a", "**굵게** ", "*기울임* ", "\\*", "*", "**", "***", char(0x3000), Character.toString(0x1F600))
        fun line(atoms: List<String>, count: Int) = buildString { repeat(count) { append(atoms.random(random)) } }
        // 서식 안에 서식을 넣어 만든 줄. 겹친 기호가 붙어 있어 안쪽의 맨 앞·맨 끝에서 판정이 갈리는 모양이 많이 나온다.
        fun nested(depth: Int): String = when (if (depth == 0) 0 else random.nextInt(6)) {
            0 -> listOf("a", "글", "a b", " ", "", "\\*", "*").random(random)
            1, 2 -> "**" + nested(depth - 1) + "**"
            3, 4 -> "*" + nested(depth - 1) + "*"
            else -> nested(depth - 1) + nested(depth - 1)
        }
        // 모두 24,100줄: 짧은 줄 20,000 + 문단 길이 1,000 + 겹친 서식 3,000 + 길이 상한 앞뒤 90 + 손으로 만든 10.
        val lines = List(20_000) { line(if (it % 2 == 0) symbols else stars, 1 + random.nextInt(40)) } +
            List(1_000) { line(if (it % 2 == 0) symbols else stars, 40 + random.nextInt(260)) } +
            List(3_000) { nested(1 + random.nextInt(12)) } +
            // 길이 상한(2,000자) 앞뒤인 1,996~2,004자.
            List(90) { line(listOf(symbols, stars, prose)[it / 9 % 3], 2100).take(1996 + it % 9) } +
            // 깊은 겹침과, 정규식 구현이 느렸던 모양을 줄인 것.
            listOf(
                "*".repeat(201) + "a", "*".repeat(100) + "a" + "*".repeat(101), "**가 ".repeat(40) + "*".repeat(80),
                "*a* ".repeat(20) + "**b ".repeat(40), "**a** ".repeat(14) + "*b ".repeat(55), "**a *b *b ".repeat(20) + "*".repeat(40),
                "*a ".repeat(80), "**a ".repeat(60), "*a* ".repeat(60), "**a** ".repeat(40),
            )
        for (text in lines) assertEquals(oracle(text), drawn(text)) { "줄(UTF-16): " + text.map { "%04x".format(it.code) } }
    }

    @Test fun `crafted lines at the length limit are drawn in linear time`() {
        // 서식이 하나 맞을 때마다 두 정규식을 처음부터 다시 찾던 구현은 이 2,000자 줄 하나에 1~3초가 걸렸다(줄 길이의 세제곱).
        // 한도를 넉넉히 두어 그 시간으로 되돌아가는 것만 막는다.
        val lines = listOf("*a* ".repeat(167) + "**b ".repeat(333), "**a** ".repeat(111) + "*b ".repeat(444), "**a *b *b ".repeat(166) + "*".repeat(332), "**a *b ".repeat(222) + "*".repeat(444))
        assertTimeout(Duration.ofSeconds(10)) { repeat(5) { lines.forEach { drawn(it) } } }
    }
}
