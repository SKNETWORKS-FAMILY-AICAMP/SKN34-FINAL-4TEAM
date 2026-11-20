package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.work.domain.MAX_FEATURED_GENRES
import ai.storyfork.content.work.domain.genreEmoji
import ai.storyfork.content.work.domain.genreName
import ai.storyfork.content.work.domain.nextGenreCode
import ai.storyfork.content.work.entity.GenreEntity
import ai.storyfork.content.work.repository.GenreRepository
import ai.storyfork.content.work.repository.WorkGenreRepository
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

/**
 * 작품·세계관 장르의 정본 관리다(DEC-56). 공개 목록은 활성 장르만, 운영은 숨김 포함 전체를 다루며 삭제는 없다(작품·세계관이 참조한다).
 * 쓰기는 모든 장르 행을 잠근 트랜잭션 하나에서 검사·저장하고, 응답은 커밋 뒤에 만든다(사용 수가 WorldStudio 읽기를 포함하므로 Content 트랜잭션과 겹치지 않게 한다).
 */
@Service
class GenreService(
    private val genres: GenreRepository,
    private val workGenres: WorkGenreRepository,
    private val worlds: StudioWorldRepository,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    /** 활성 장르를 표시 순서대로 돌려준다(비로그인 공개 목록). */
    fun active(): List<PublicGenreResponse> = genres.findActive().map { PublicGenreResponse(it.code, it.name, it.emoji, it.featured) }

    /** 숨김 포함 전체 장르를 표시 순서대로 돌려준다. 사용 수는 장르별 집계 쿼리 한 번씩이다. */
    fun list(): List<GenreResponse> {
        val inWorks = workGenres.workCounts().associate { it[0] as String to (it[1] as Number).toInt() }
        val inWorlds = worlds.worldCounts().associate { it[0] as String to (it[1] as Number).toInt() }
        return genres.findAll(Sort.by("position", "code")).map { it.response(inWorks[it.id] ?: 0, inWorlds[it.code] ?: 0) }
    }

    /** 새 장르를 맨 뒤 순서의 활성 장르로 만든다. 코드는 다음 번호이고 홈 노출은 꺼 둔다. */
    fun create(request: GenreCreateRequest): GenreResponse {
        val name = genreName(request.name)
        val emoji = genreEmoji(request.emoji)
        // ponytail: 두 운영자가 동시에 추가하면 같은 번호가 PK 충돌(500)로 끝난다. 운영자 한 명이 쓰는 화면이라 잠금용 행을 두지 않는다.
        val created = transaction.execute {
            val all = genres.lockAll()
            checkNameFree(all, name, null)
            val code = nextGenreCode(all.map { it.code })
            GenreEntity(code, code, name, true, (all.maxOfOrNull { it.position } ?: 0) + 1, false, emoji).also { genres.saveAndFlush(it) }
        }!!
        return created.response(0, 0)
    }

    /**
     * 보낸 필드만 바꾼다. 홈에 보이는 장르(활성이면서 홈 노출)는 최대 6개이며, 이 장르가 칩이 되는 변경(홈 노출을 켜거나 홈 노출을 켠 숨긴 장르를 다시 보이게 함)이
     * 이미 6개인 칩에 하나를 더하면 409 GENRE_FEATURED_LIMIT이다. 다른 장르가 칩에 있는 수만 세므로 이미 칩인 장르의 다른 변경과 칩을 줄이는 변경은 늘 된다.
     */
    fun update(code: String, request: GenreUpdateRequest): GenreResponse {
        val name = request.name?.let { genreName(it) }
        val emoji = request.emoji?.let { genreEmoji(it) }
        transaction.execute {
            val all = genres.lockAll()
            val row = all.singleOrNull { it.code == code } ?: throw ContentFailure(404, "장르를 찾을 수 없어요.")
            if (name != null) checkNameFree(all, name, row)
            val active = request.active ?: row.active
            val featured = request.featured ?: row.featured
            if (active && featured && all.count { it !== row && it.active && it.featured } >= MAX_FEATURED_GENRES)
                throw ContentFailure(409, "홈에는 장르를 최대 ${MAX_FEATURED_GENRES}개까지 보일 수 있어요.", "GENRE_FEATURED_LIMIT")
            if (name != null) row.name = name
            if (request.emoji != null) row.emoji = emoji
            row.active = active
            row.featured = featured
            genres.saveAndFlush(row)
        }
        return list().first { it.code == code }
    }

    /** 표시 순서를 바꾼다. [GenreOrderRequest.codes]는 숨긴 장르를 포함한 전체 코드를 한 번씩 담아야 하며 어긋나면 422다. */
    fun reorder(request: GenreOrderRequest): List<GenreResponse> {
        transaction.execute {
            val all = genres.lockAll()
            val codes = request.codes.orEmpty()
            checkContent(codes.size == all.size && codes.toSet() == all.map { it.code }.toSet(), message = "순서에는 모든 장르 코드를 한 번씩 담아 주세요.")
            val byCode = all.associateBy { it.code }
            codes.forEachIndexed { index, code -> byCode.getValue(code).position = index + 1 }
            genres.flush()
        }
        return list()
    }

    /** [name]을 쓰는 다른 장르가 없는지 본다([self]는 제외). 같은 이름 두 개는 DB UNIQUE도 막지만 먼저 409로 알린다. */
    private fun checkNameFree(all: List<GenreEntity>, name: String, self: GenreEntity?) {
        if (all.any { it !== self && it.name == name }) throw ContentFailure(409, "이미 있는 장르 이름이에요.", "GENRE_NAME_TAKEN")
    }

    private fun GenreEntity.response(workCount: Int, worldCount: Int) =
        GenreResponse(code, name, emoji, active, featured, position, workCount, worldCount)
}
