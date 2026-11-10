package ai.storyfork.operations._common

/**
 * 비어 있다고 보아야 하는 값. `@NotBlank`(String.isBlank)는 U+00A0·U+2007·U+202F만 있는 값을 통과시키고
 * DB `CHECK (~ '[^[:space:]]')`도 이 문자를 통과시키므로, 서비스의 `isNotBlank`가 400으로 막아야 한다.
 */
val blankTexts = listOf("", " \t\n", " ", " ", " ")
