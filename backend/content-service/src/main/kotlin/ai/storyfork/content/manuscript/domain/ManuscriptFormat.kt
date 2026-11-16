package ai.storyfork.content.manuscript.domain

/**
 * 원고 기본 서식(DEC-48) 문법. 정본은 `docs/design/manuscript-format-contract.md`이고 프런트(TypeScript)가 같은 검증 표로 따로 구현하므로
 * 문법을 넓히거나 좁히지 않는다. 서식 기호는 그릴 때만 해석하고 저장한 글은 바꾸지 않는다.
 */
object ManuscriptFormat {
    enum class Kind { BLANK, IMAGE, DIVIDER, HEADING, QUOTE, PARAGRAPH }

    /** 판정한 줄 하나. content는 줄 안 서식을 해석할 글이며 이미지 줄은 이미지 ID, 빈 줄·구분선은 빈 글이다. */
    class Line(val kind: Kind, val content: String = "")

    // 계약의 기준은 JavaScript 정규식이다. Java의 `(?U)\s`는 U+0085를 공백으로 보고 U+FEFF를 공백으로 보지 않으며 `.`은 U+0085를 건너지 못한다.
    // 그래서 JavaScript의 `\s`(SPACE·isSpace)와 `.`(ANY, isBreak가 아닌 글자)과 같은 글자 집합을 직접 적는다.
    private const val SPACE = "\\t\\n\\x0B\\f\\r \\xA0\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}"
    private const val ANY = "[^\\n\\r\\x{2028}\\x{2029}]"
    private val IMAGE_LINE = Regex("\\[\\[image:([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})\\]\\]")
    private val DIVIDER_LINE = Regex("-{3,}|\\*{3,}")
    private val HEADING_LINE = Regex("#{1,6} ($ANY*[^$SPACE]$ANY*)")
    private val QUOTE_LINE = Regex("> ?($ANY*)")
    private val LINE_ESCAPE = Regex("^\\\\([#>-])")
    private const val MAX_INLINE_LENGTH = 2_000

    private fun isSpace(ch: Char) = when (ch.code) {
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, in 0x2000..0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF -> true
        else -> false
    }
    private fun isBreak(ch: Char) = when (ch.code) { 0x0A, 0x0D, 0x2028, 0x2029 -> true; else -> false }

    /** 줄 하나를 위에서부터 처음 맞는 규칙으로 판정한다. 규칙은 줄 전체에 맞아야 하고, 문단 줄 맨 앞의 `\#`·`\>`·`\-`는 백슬래시를 뗀다. */
    fun line(line: String): Line {
        if (line.isEmpty()) return Line(Kind.BLANK)
        IMAGE_LINE.matchEntire(line)?.let { return Line(Kind.IMAGE, it.groupValues[1]) }
        if (DIVIDER_LINE.matches(line)) return Line(Kind.DIVIDER)
        HEADING_LINE.matchEntire(line)?.let { return Line(Kind.HEADING, it.groupValues[1]) }
        QUOTE_LINE.matchEntire(line)?.let { return Line(Kind.QUOTE, it.groupValues[1]) }
        return Line(Kind.PARAGRAPH, line.replaceFirst(LINE_ESCAPE, "$1"))
    }

    /**
     * 계약의 굵게(size 2)·기울임(size 1) 정규식이 맞는 자리를 왼쪽부터 찾는 스캐너다.
     * 정규식의 `(.+?)`는 여는 기호 뒤의 첫 닫는 기호에서 멈추고 줄바꿈 글자를 건너지 못하므로, 여는 기호가 뒤로 갈수록 닫는 기호와 줄바꿈 글자를 찾는 자리도
     * 뒤로만 간다. 그래서 내용 하나를 한 번만 훑는다. 정규식을 그대로 되풀이해 찾는 구현은 `ManuscriptFormatTest`에 기준으로 남아 결과가 같은지 지킨다.
     */
    private class Marks(private val s: String, val size: Int) {
        /** 찾은 서식의 여는 기호와 닫는 기호가 시작하는 자리. 안쪽은 start + size부터 end 앞까지다. */
        var start = -1; private set
        var end = -1; private set
        private var next = 0     // 여는 기호를 아직 살펴보지 않은 첫 자리
        private var closer = 0   // 닫는 기호를 찾아 둔 자리
        private var stop = 0     // 줄바꿈 글자를 찾아 둔 자리

        private fun star(i: Int) = i < s.length && s[i] == '*'
        private fun marks(i: Int) = star(i) && (size == 1 || star(i + 1))
        // 여는 기호: 앞이 백슬래시가 아니고 바로 뒤가 공백이 아니다. 기울임은 앞뒤가 별표여도 안 된다.
        private fun opens(p: Int) = marks(p) && (p == 0 || s[p - 1] != '\\' && (size == 2 || s[p - 1] != '*')) &&
            p + size < s.length && !isSpace(s[p + size]) && (size == 2 || s[p + size] != '*')
        // 닫는 기호: 바로 앞이 공백·백슬래시가 아니고 뒤에 별표가 더 없다. 기울임은 바로 앞이 별표여도 안 된다.
        private fun closes(q: Int) = marks(q) && !isSpace(s[q - 1]) && s[q - 1] != '\\' && (size == 2 || s[q - 1] != '*') && !star(q + size)

        /** from 이후에서 시작하는 첫 서식을 찾아 start·end에 둔다. from은 부를 때마다 같거나 커야 한다. */
        fun find(from: Int): Boolean {
            if (start >= from) return true
            var p = maxOf(from, next)
            while (p + size < s.length) {
                if (opens(p)) {
                    // 안쪽은 한 글자 이상이라 닫는 기호는 p + size + 1부터다. 더 없으면 뒤의 여는 기호도 닫히지 않는다.
                    closer = maxOf(closer, p + size + 1)
                    while (closer < s.length && !closes(closer)) closer++
                    if (closer >= s.length) break
                    // 여는 기호와 닫는 기호 사이에 줄바꿈 글자가 있으면 닫히지 않는다.
                    stop = maxOf(stop, p + size)
                    while (stop < closer && !isBreak(s[stop])) stop++
                    if (stop == closer) { start = p; end = closer; next = p + 1; return true }
                }
                p++
            }
            start = -1; next = s.length
            return false
        }
    }

    /**
     * 줄 안의 굵게·기울임을 해석한다. 글자 조각은 text로, 굵게·기울임은 안쪽을 같은 방법으로 해석한 결과를 bold·italic으로 바꿔 이어 붙인다.
     * 왼쪽부터 두 서식 중 먼저 시작하는 것을 고르고, 글자 조각의 `\*`는 별표가 된다.
     * 내용이 [MAX_INLINE_LENGTH]자(UTF-16 단위)를 넘으면 해석하지 않고 내용 그대로 text에 넘긴다(계약의 길이 상한).
     * 걸리는 시간은 내용 길이 × 겹침 깊이에 비례하고 겹침 깊이만큼 재귀한다. 한 겹에 기호와 글자가 네 자 이상 들어 길이 상한 안에서는 500겹을 넘지 않는다.
     */
    fun inline(content: String, text: (String) -> String, bold: (String) -> String, italic: (String) -> String): String {
        if (content.length > MAX_INLINE_LENGTH) return text(content)
        fun plain(part: String) = text(part.replace("\\*", "*"))
        val strong = Marks(content, 2)
        val emphasis = Marks(content, 1)
        val out = StringBuilder()
        var from = 0
        while (true) {
            val hasStrong = strong.find(from)
            val hasEmphasis = emphasis.find(from)
            val mark = if (hasStrong && (!hasEmphasis || strong.start < emphasis.start)) strong else if (hasEmphasis) emphasis else break
            out.append(plain(content.substring(from, mark.start)))
            // 안쪽은 따로 뗀 글로 다시 해석한다. 안쪽의 맨 앞·맨 끝에서는 바깥 기호가 보이지 않아야 계약의 정규식과 결과가 같다.
            val inner = inline(content.substring(mark.start + mark.size, mark.end), text, bold, italic)
            out.append(if (mark === strong) bold(inner) else italic(inner))
            from = mark.end + mark.size
        }
        return out.append(plain(content.substring(from))).toString()
    }
}
