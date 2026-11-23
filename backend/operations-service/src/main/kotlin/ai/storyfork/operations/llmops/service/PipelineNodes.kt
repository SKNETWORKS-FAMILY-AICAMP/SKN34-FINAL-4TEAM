package ai.storyfork.operations.llmops.service

/**
 * A node of the AI pipeline (DEC-58): its place in the flow and the observations that are its own. Every observation of a request carries the tag feature:<key>
 * of that request, so [feature] says which requests to look in: the writing chat ("orchestration"), where an agent's or a tool's observations are told apart by
 * name, or the request of a standalone feature, whose observations are those named after the feature key ([prefix]). [names] are exact names and [prefix] stands
 * for a family of them. ponytail: the names are those of the AI service (its tracing.observe calls and the step.<feature> of orchestration/tools.py), so a new
 * agent or observation needs a line here, and a name that no node lists is counted nowhere. [next] are the nodes it leads to; an agent also leads back to the main agent
 * that called it, so the links make a cycle.
 */
internal class NodeSpec(
    val id: String, val label: String, val next: List<String>, val feature: String,
    val names: Set<String> = emptySet(), val prefix: String? = null, val standalone: Boolean = false,
) {
    fun owns(name: String) = if (prefix != null) name.startsWith(prefix) else name in names
}

private const val CHAT = "orchestration"
private val APPLY = listOf("apply")
private val BACK = listOf("main")
// The agents that read or review, then those that write (writing, world and character_simulation: the ones with an approval).
private val AGENTS = listOf("qa", "manuscript_review", "rating", "research", "writing", "world", "character_simulation")

private fun chat(id: String, label: String, next: List<String>, vararg names: String) = NodeSpec(id, label, next, CHAT, names.toSet())

/** A standalone feature is its own request: tagged feature:<[feature]>, with the observations in it named after the key ([prefix]; writing_editing's are writing.…). */
private fun alone(id: String, label: String, feature: String = id, prefix: String = feature) =
    NodeSpec(id, label, emptyList(), feature, prefix = prefix, standalone = true)

/** The nodes in flow order: the request, the guard, the main agent, its seven agents (the recall of the simulation after it) and its tools, the approval, then the standalone features. */
internal val PIPELINE_NODES = listOf(
    chat("request", "집필 AI 요청", listOf("guard"), "orchestration"),
    chat("guard", "Decision Guard", listOf("main"), "decision_guard", "decision_guard.generation"),
    chat("main", "메인 에이전트", AGENTS + "mcp", "main_agent", "main_agent.blocked"),
    chat("qa", "작품 질문", BACK, "step.story_context", "story_context.qa", "qa.generation", "retrieval", "retrieval.embedding", "retrieval.elasticsearch", "retrieval.postgres_verify",
        "world_read", "evidence_check"),
    chat("manuscript_review", "원고 검수", BACK, "step.manuscript_review", "manuscript_review.generation"),
    chat("rating", "심의 등급", BACK, "step.rating", "rating.generation"),
    chat("research", "고증 조사", BACK, "step.research", "research.generation", "research.platform_pick", "research.platform_refer"),
    chat("writing", "기획·집필·수정", APPLY + BACK, "step.writing_editing", "writing.plan", "writing.plan_pick", "writing.plan_revise", "writing.generation"),
    chat("world", "세계관", APPLY + BACK, "step.world", "world_review", "world_review.generation", "world_review.enrich", "world_review.enrich.generation", "world_review.impact",
        "world_review.impact.generation"),
    chat("character_simulation", "인물 시뮬레이션", APPLY + "novelbrain" + BACK, "step.character_simulation", "step.character_simulation.plan", "simulation.plan", "simulation.act",
        "simulation.narrate", "simulation.check", "simulation.director", "simulation.turn"),
    // The recall NovelBrain makes for the characters of the simulation (it is also made inside the rating, which has no link to it).
    chat("novelbrain", "NovelBrain 기억 회상", emptyList(), "novelbrain.recall"),
    NodeSpec("mcp", "Content MCP 도구", emptyList(), CHAT, prefix = "mcp."),
    // An approval changes the work through the Content tools.
    chat("apply", "작가 승인 반영", listOf("mcp"), "step.writing_editing.apply", "step.world.apply", "step.character_simulation.apply"),
    alone("proposals", "전개 제안"),
    alone("initial_world", "초기 세계관 분석"),
    alone("manuscript_extraction", "원고 설정 추출"),
    alone("work_tags", "장르·키워드 추천"),
    alone("world_review", "설정집 검토"),
    // The agent "rating" is a node of the chat already: its own request is told apart by its id, not by its feature key.
    alone("rating_direct", "심의 등급(단독)", "rating"),
    // Content calls writing/drafts and writing/patches itself: a request of its own, besides the writing agent of the chat.
    alone("writing_editing", "새 원고·부분 수정", prefix = "writing"),
)
