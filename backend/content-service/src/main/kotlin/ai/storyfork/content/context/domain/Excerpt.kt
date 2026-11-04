package ai.storyfork.content.context.domain

data class Excerpt(val start: Int, val end: Int, val text: String)

fun sourceExcerpts(body: String, limit: Int, query: String): List<Excerpt> {
    if (body.isEmpty() || limit == 0) return emptyList()
    if (body.length <= limit) return listOf(Excerpt(0,body.length,body))
    val terms = Regex("[가-힣A-Za-z0-9]{2,}").findAll(query).map { it.value }.distinct().take(30).toList()
    val tail = minOf(limit/2,3000)
    val ranges = mutableListOf((body.length-tail) until body.length)
    var remaining = limit-tail
    val candidates = Regex("[^\n]+(?:\n|$)").findAll(body).toList().sortedWith(compareByDescending<MatchResult> { match -> terms.count { it in match.value } }.thenByDescending { it.range.first })
    for (m in candidates) {
        if (ranges.size >= 24 || remaining <= 0) break
        val start = m.range.first
        val end = minOf(m.range.last+1,body.length-tail,start+remaining)
        if (end > start) { ranges.add(start until end); remaining -= end-start }
    }
    return ranges.sortedBy { it.first }.map { Excerpt(it.first,it.last+1,body.substring(it.first,it.last+1)) }
}
