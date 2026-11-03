package ai.storyfork.core._common.helper

import java.util.UUID

/** 기존 정본·버전·참조의 UUID 계산을 그대로 유지한다. */
fun contentKey(vararg parts: String): String = UUID.nameUUIDFromBytes(parts.joinToString("\u0000").toByteArray(Charsets.UTF_8)).toString()
fun contentId(): String = UUID.randomUUID().toString()
fun episodeId(work: String, number: Int): String = contentKey("episode", work, number.toString())
fun episodeVersionId(work: String, number: Int, version: String): String = contentKey("episode-version", episodeId(work, number), version)
fun settingDocumentId(world: String, logicalId: String): String = contentKey("setting", world, logicalId)
fun settingVersionId(world: String, logicalId: String, version: String): String = contentKey("setting-version", settingDocumentId(world, logicalId), version)
