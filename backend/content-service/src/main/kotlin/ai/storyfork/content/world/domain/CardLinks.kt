package ai.storyfork.content.world.domain

import java.util.UUID

/**
 * 설정 카드 본문 링크 `[글자](card:<uuid>)`의 문법 하나다(DEC-53, docs/design/worldstudio-independent-schema.md '카드 본문 링크'). 줄·코드·이스케이프 같은 마크다운 문맥을 보지 않고
 * 본문을 통째로 훑으므로 코드 안의 것도 링크이고 서버 치환이 파서 차이로 새지 않는다. 화면(TypeScript)·AI 입력 경계(Python)가 같은 정규식과 검증 표를 따로 구현한다.
 * 글자 길이는 JavaScript가 UTF-16 단위로, 이 정규식이 코드 포인트로 센다. 이쪽이 링크로 보는 범위가 같거나 더 넓어(더 많이 숨기는 쪽) 치환이 새지 않는다.
 * 마크다운 파서는 이 정규식이 링크로 보지 않는 모양(`<card:id>`·`[글자](<card:id>)`·제목이 붙은 링크·글자에 대괄호나 줄바꿈이 든 링크)도 `card:` 주소로 읽을 수 있다.
 * 그래서 링크 치환 뒤에 남은 `card:<uuid>`도(대소문자 무시) 대상이 보이는 카드가 아니면 지워 숨은 카드의 id가 응답 어디에도 남지 않게 한다.
 */
private const val UUID_PATTERN = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
private val CARD_LINK = Regex("""\[([^\[\]\r\n]{1,200})\]\(card:($UUID_PATTERN)\)""")
private val CARD_REF = Regex("card:($UUID_PATTERN)", RegexOption.IGNORE_CASE)

/** 대상이 [visible](응답에 실리는 보이는 카드의 id)에 없는 링크는 글자만 남기고 id를 지운다. 있으면 그대로 둔다. id의 대소문자는 가리지 않는다. 링크가 아닌 모양에 남은 `card:<uuid>`도 같은 기준으로 지운다. */
fun hideCardLinks(text: String, visible: Set<UUID>): String =
    CARD_LINK.replace(text) { link -> if (UUID.fromString(link.groupValues[2]) in visible) link.value else link.groupValues[1] }
        .let { linked -> CARD_REF.replace(linked) { ref -> if (UUID.fromString(ref.groupValues[1]) in visible) ref.value else "" } }

/** 모든 링크를 글자로 바꾸고 남은 `card:<uuid>`도 지운다. 대상이 보이든 아니든 모델 입력·색인에 id가 섞이지 않게 하는 AI 입력 경계의 규칙이다. */
fun stripCardLinks(text: String): String = hideCardLinks(text, emptySet())
