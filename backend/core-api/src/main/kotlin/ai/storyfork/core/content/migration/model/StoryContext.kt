package ai.storyfork.core.content.migration.model

data class Excerpt(val start: Int, val end: Int, val text: String)
data class ContextEpisode(val number: Int, val version: Int, val versionId: String, val title: String, val sourceCharacters: Int, val excerpts: List<Excerpt>)
data class Selection(val omittedCharacters: Int, val eligibleEpisodes: Int, val method: String = "source-excerpts", val note: String = "선택된 원문 발췌입니다. 전체 원고 요약이 아닙니다. 인물 시점은 허용 설정만 사용합니다.")
data class StoryContext(val title: String, val summary: String, val basisEpisode: Int, val character: String, val settings: List<Setting>, val draft: String, val episodes: List<ContextEpisode>, val selection: Selection)

fun selectSettings(history: List<Setting>, episode: Int, public: Boolean = false, character: String = ""): List<Setting> =
    history.filter { it.fromEpisode <= episode }.associateBy { it.id }.values.filter {
        (it.toEpisode == null || episode <= it.toEpisode) && (!public || it.visibility == "public") &&
            (character.isEmpty() || "*" in it.knownBy || character in it.knownBy)
    }

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

fun buildContext(w: ContentWork, history: List<Setting>, episode: Int, query: String = "", character: String = "", public: Boolean = false): StoryContext {
    val max = w.episodes.size + if(public) 0 else 1
    checkContent(episode in 1..max, message="공개 회차 또는 현재 작성 회차를 선택해 주세요.")
    val settings = selectSettings(history,episode,public || w.world.mode=="following",character)
    val draft = if (!public && character.isEmpty() && episode==max) w.draft.body else ""
    // Reserve JSON metadata/escaping space; the service checks the final serialized payload too.
    val budget = 48000-draft.length-settings.sumOf { it.content.length+it.name.length+it.evidence.length+it.knownBy.sumOf(String::length)+it.tags.sumOf(String::length)+700 }
    checkContent(budget>=0,message="설정과 현재 원고가 문맥 한도를 넘어요. 범위를 좁혀 주세요. 저장본은 보존됩니다.")
    val eligible = w.episodes.filter { it.number<=episode }
    val selected = if(character.isEmpty()) eligible.takeLast(3) else emptyList()
    val episodes = selected.map { ContextEpisode(it.number,it.version,it.versionId,it.title,it.body.length,sourceExcerpts(it.body,minOf(10000,budget/maxOf(1,selected.size)),query)) }
    return StoryContext(w.title,if(character.isEmpty()) w.summary else "",episode,character,settings,draft,episodes,
        Selection(eligible.sumOf { it.body.length }-episodes.sumOf { e -> e.excerpts.sumOf { it.text.length } },eligible.size))
}
