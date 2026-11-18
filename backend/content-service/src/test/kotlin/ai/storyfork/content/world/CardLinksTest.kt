package ai.storyfork.content.world

import ai.storyfork.content.world.domain.hideCardLinks
import ai.storyfork.content.world.domain.stripCardLinks
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory

/**
 * 카드 본문 링크 [글자](card:<uuid>) 문법(DEC-53, docs/design/worldstudio-independent-schema.md '링크 검증 표')의 검사다.
 * 같은 행을 화면(TypeScript)과 AI 입력 경계(Python)도 따로 검사한다. 링크로 인정한 것은 글자만 남기고, 인정하지 않은 모양(마크다운 파서는 링크로 읽을 수 있다)에
 * 남은 card:<uuid>는 숨은 카드의 id가 남지 않게 지운다(대소문자 무시).
 */
class CardLinksTest {
    private val a = "aaaaaaaa-2222-3333-4444-555555555555"
    private val b = "bbbbbbbb-2222-3333-4444-555555555555"
    private fun ids(vararg ids: String) = ids.map(UUID::fromString).toSet()

    @TestFactory fun `링크 검증 표 - 글자로 벗긴 결과`() = listOf(
        "[승상](card:$a)" to "승상",
        "앞 [갑](card:$a) 중 [을](card:$b) 뒤" to "앞 갑 중 을 뒤",
        "[갑](card:$a)[을](card:$b)" to "갑을",
        "[갑](card:${a.uppercase()})" to "갑",
        "`[갑](card:$a)`" to "`갑`",
        "[](card:$a)" to "[]()",
        "[갑](card:1111)" to "[갑](card:1111)",
        "[갑](card: $a)" to "[갑](card: $a)",
        "[갑](CARD:$a)" to "[갑]()",
        "[갑](https://example.com)" to "[갑](https://example.com)",
        "[[갑]](card:$a)" to "[[갑]]()",
        "[갑\n을](card:$a)" to "[갑\n을]()",
        "[${"가".repeat(200)}](card:$a)" to "가".repeat(200),
        "[${"가".repeat(201)}](card:$a)" to "[${"가".repeat(201)}]()",
        "[갑[을]](card:$a)" to "[갑[을]]()",
        "[갑]을](card:$a)" to "[갑]을]()",
        "([갑](card:$a))" to "(갑)",
        "card:$a" to "",
        "<card:$a>" to "<>",
        "[갑](<card:$a>)" to "[갑](<>)",
        "[갑](card:$a \"t\")" to "[갑]( \"t\")",
    ).mapIndexed { index, (body, stripped) -> dynamicTest("${index + 1}. ${body.take(30)}") { assertEquals(stripped, stripCardLinks(body)) } }

    @TestFactory fun `링크 검증 표 - 숨김 치환`() = listOf(
        Triple("[승상](card:$a)", ids(a), "[승상](card:$a)"),
        Triple("[승상](card:$a)", ids(), "승상"),
        Triple("[승상](card:$a)", ids(b), "승상"),
        Triple("앞 [갑](card:$a) 뒤 [을](card:$b)", ids(b), "앞 갑 뒤 [을](card:$b)"),
        Triple("`[갑](card:$a)`", ids(), "`갑`"),
        Triple("[갑](card:${a.uppercase()})", ids(a), "[갑](card:${a.uppercase()})"),
        Triple("card:$a", ids(a), "card:$a"),
        Triple("card:$a", ids(), ""),
        Triple("<card:$a>", ids(a), "<card:$a>"),
        Triple("<card:$a>", ids(), "<>"),
        Triple("[갑](<card:$a>)", ids(), "[갑](<>)"),
        Triple("[갑](card:$a \"t\")", ids(), "[갑]( \"t\")"),
        Triple("[[갑]](card:$a)", ids(a), "[[갑]](card:$a)"),
        Triple("[[갑]](card:$a)", ids(), "[[갑]]()"),
        Triple("[갑](card:$a) <card:$b>", ids(b), "갑 <card:$b>"),
        Triple("[갑](CARD:${a.uppercase()})", ids(), "[갑]()"),
    ).mapIndexed { index, (body, visible, hidden) -> dynamicTest("${index + 1}. ${body.take(30)}") { assertEquals(hidden, hideCardLinks(body, visible)) } }
}
