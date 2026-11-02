package ai.storyfork.core.content.domain

import java.security.MessageDigest

fun settingsToken(history: List<Setting>): String = MessageDigest.getInstance("SHA-256").digest(history.toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
data class WorldChange(val id: String, val settingId: String, val before: Setting?, val after: Setting?, val decision: String)
data class WorldView(val id: String, val name: String, val revision: Int, val mode: String, val basis: Basis?, val draft: Setting?, val drafts: List<Setting>, val settings: List<Setting>, val history: List<Setting>, val sourceToken: String, val changes: List<WorldChange>)

fun inheritedSettings(w: ContentWork, source: ContentWork?): List<Setting> =
    if(w.source == null || source == null) emptyList() else selectSettings(source.world.history,w.source.episode,true)

fun effectiveHistory(w: ContentWork, source: ContentWork?): List<Setting> {
    if(w.world.mode!="following") return w.world.history.toList()
    checkContent(source!=null && w.source!=null,404,"원작을 찾을 수 없어요.")
    val basis = w.source!!.episode
    val history = source!!.world.history
    val allowed = (1..basis).flatMap { selectSettings(history,it,true) }
    val versions = allowed.map { it.versionId }.toSet()
    val ids = allowed.map { it.id }.toSet()
    return history.filter { it.fromEpisode<=basis && (it.versionId in versions || it.id in ids) }.map {
        if(it.versionId in versions) it else it.copy(name="공개 범위에서 제외",content="",tags=emptyList(),knownBy=emptyList(),evidence="",visibility="private")
    }
}

fun detachWorld(w: ContentWork, source: ContentWork?) {
    if(w.world.mode!="following") return
    w.world.history = effectiveHistory(w,source).toMutableList()
    w.world.sourceSnapshot = inheritedSettings(w,source)
    w.world.mode = "independent"
}

fun worldChanges(w: ContentWork, source: ContentWork?): List<WorldChange> {
    if(w.world.mode!="independent") return emptyList()
    val before = w.world.sourceSnapshot.associateBy { it.id }
    val after = inheritedSettings(w,source).associateBy { it.id }
    return (before.keys+after.keys).sorted().mapNotNull { id ->
        val a=before[id]; val b=after[id]
        if(a==b) null else {
            val token = settingsToken(listOfNotNull(a,b))
            WorldChange(token,id,a,b,w.world.decisions[token] ?: "pending")
        }
    }
}

fun worldView(w: ContentWork, source: ContentWork?): WorldView {
    val h = effectiveHistory(w,source)
    return WorldView(w.id,w.title+" 설정집",w.world.revision,w.world.mode,w.world.basis,w.world.draft,w.world.drafts.values.toList(),h.associateBy { it.id }.values.filter { it.content.isNotEmpty() },h,settingsToken(h),worldChanges(w,source))
}

fun appendSetting(w: ContentWork, setting: Setting) {
    w.world.history.add(setting.copy(versionId=contentId()))
    w.world.drafts.remove(setting.id)
    w.world.draft=w.world.drafts.values.lastOrNull()
    w.world.revision++
}
