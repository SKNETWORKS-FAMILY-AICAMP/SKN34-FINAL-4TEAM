package ai.storyfork.core.world.domain

class WorldState(var revision: Int = 0, var mode: String = "own",
    var history: MutableList<Setting> = mutableListOf(),
    val drafts: MutableMap<String, Setting> = linkedMapOf(),
    var sourceSnapshot: List<Setting> = emptyList(),
    val decisions: MutableMap<String, String> = linkedMapOf())
