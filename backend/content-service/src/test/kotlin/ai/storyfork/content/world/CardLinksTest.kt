package ai.storyfork.content.world

import ai.storyfork.content.world.domain.hideCardLinks
import ai.storyfork.content.world.domain.stripCardLinks
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory

/**
 * 카드 본문 링크 [글자](card:<uuid>) 문법(DEC-53, docs/design/worldstudio-independent-schema.md '링크 검증 표')의 검사다.
 * 같은 행을 화면(TypeScript)과 AI 입력 경계(Python)도 따로 검사한다. 링크를 찾는지는 글자로 벗긴 결과(링크면 글자만 남고 아니면 그대로)로 본다.
 */
class CardLinksTest {
    private val a = "aaaaaaaa-2222-3333-4444-555555555555"
    private val b = "bbbbbbbb-2222-3333-4444-555555555555"
    private fun ids(vararg ids: String) = ids.map(UUID::fromString).toSet()

    @TestFactory fun `링크 검증 표 - 찾는 링크`() = listOf(
        "[승상](card:$a)" to "승상",
        "앞 [갑](card:$a) 중 [을](card:$b) 뒤" to "앞 갑 중 을 뒤",
        "[갑](card:$a)[을](card:$b)" to "갑을",
        "[갑](card:${a.uppercase()})" to "갑",
        "`[갑](card:$a)`" to "`갑`",
        "[](card:$a)" to "[](card:$a)",
        "[갑](card:1111)" to "[갑](card:1111)",
        "[갑](card: $a)" to "[갑](card: $a)",
        "[갑](CARD:$a)" to "[갑](CARD:$a)",
        "[갑](https://example.com)" to "[갑](https://example.com)",
        "[[갑]](card:$a)" to "[[갑]](card:$a)",
        "[갑\n을](card:$a)" to "[갑\n을](card:$a)",
        "[${"가".repeat(200)}](card:$a)" to "가".repeat(200),
        "[${"가".repeat(201)}](card:$a)" to "[${"가".repeat(201)}](card:$a)",
        // 중첩 괄호: 글자 안의 대괄호·바깥 소괄호
        "[갑[을]](card:$a)" to "[갑[을]](card:$a)",
        "[갑]을](card:$a)" to "[갑]을](card:$a)",
        "([갑](card:$a))" to "(갑)",
    ).mapIndexed { index, (body, stripped) -> dynamicTest("${index + 1}. ${body.take(30)}") { assertEquals(stripped, stripCardLinks(body)) } }

    @TestFactory fun `링크 검증 표 - 숨김 치환`() = listOf(
        Triple("[승상](card:$a)", ids(a), "[승상](card:$a)"),
        Triple("[승상](card:$a)", ids(), "승상"),
        Triple("[승상](card:$a)", ids(b), "승상"),
        Triple("앞 [갑](card:$a) 뒤 [을](card:$b)", ids(b), "앞 갑 뒤 [을](card:$b)"),
        Triple("`[갑](card:$a)`", ids(), "`갑`"),
        Triple("[갑](card:${a.uppercase()})", ids(a), "[갑](card:${a.uppercase()})"),
        Triple("card:$a", ids(), "card:$a"),
    ).mapIndexed { index, (body, visible, hidden) -> dynamicTest("${index + 1}. ${body.take(30)}") { assertEquals(hidden, hideCardLinks(body, visible)) } }
}
