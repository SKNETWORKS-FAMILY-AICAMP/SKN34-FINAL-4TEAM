package ai.storyfork.core.episode.domain

object EpisodeMutationPolicy {
    fun acceptsRevision(expected: Int, actual: Int) = expected == actual
    fun canDelete(inherited: Boolean, referenced: Boolean, hasFollowing: Boolean) = !inherited && !referenced && !hasFollowing
    fun candidates(number: Int, numbers: List<Int>, protected: Set<Int>): List<Int> {
        if (number in protected) return emptyList()
        return numbers.filter { target -> protected.none { it >= minOf(number,target) && it <= maxOf(number,target) } }
    }
}
