package ai.storyfork.core.world.domain

import java.security.MessageDigest

fun settingsToken(history: List<Setting>): String = MessageDigest.getInstance("SHA-256").digest(history.toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
fun selectSettings(history: List<Setting>, episode: Int, public: Boolean = false, character: String = ""): List<Setting> =
    history.filter { it.fromEpisode<=episode }.associateBy {it.id}.values.filter {
        (it.toEpisode==null || episode<=it.toEpisode) && (!public || it.visibility=="public") &&
            (character.isEmpty() || "*" in it.knownBy || character in it.knownBy)
    }
fun followingHistory(history: List<Setting>, basis: Int): List<Setting> {
    val allowed=(1..basis).flatMap {selectSettings(history,it,true)}
    val ids=allowed.map {it.id}.toSet();val versions=allowed.map {it.versionId}.toSet()
    return history.filter {it.fromEpisode<=basis && (it.versionId in versions || it.id in ids)}.map {
        if(it.versionId in versions) it else it.copy(name="공개 범위에서 제외",content="",tags=emptyList(),knownBy=emptyList(),evidence="",visibility="private")
    }
}
