package ai.storyfork.content.work.domain

fun forkableEpisodes(allowed: Boolean, scope: String, start: Int?, selected: List<Int>, published: List<Int>): List<Int> =
    if (!allowed) emptyList() else published.distinct().sorted().filter {
        when (scope) {
            "all" -> true
            "from" -> start != null && it >= start
            "selected" -> it in selected
            else -> false
        }
    }
