package ai.storyfork.content.world.domain

/** 공개 세계관·설정 카드 검색(#505)의 검색어다. 앞뒤 공백을 자르고, 없거나 공백뿐이면 null(검색하지 않음)이다. */
fun searchTerm(q: String?): String? = q?.trim()?.takeIf { it.isNotEmpty() }

/** 세계관은 확정 버전의 이름·설명이나 작가 닉네임에 [term]이 대소문자 무시로 들어 있으면 일치한다. */
fun matchesWorld(name: String, description: String, author: String, term: String): Boolean =
    listOf(name, description, author).any { it.contains(term, ignoreCase = true) }

/** 설정 카드는 제목·별칭·태그에 [term]이 대소문자 무시로 들어 있으면 일치한다. 본문은 보지 않는다(작품 검색처럼). */
fun matchesCard(title: String, aliases: List<String>, tags: List<String>, term: String): Boolean =
    (listOf(title) + aliases + tags).any { it.contains(term, ignoreCase = true) }
