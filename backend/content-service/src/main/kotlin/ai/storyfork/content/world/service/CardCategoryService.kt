package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.work.domain.genreEmoji
import ai.storyfork.content.work.domain.genreName
import ai.storyfork.content.work.domain.nextNumberedCode
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.CardCategory
import ai.storyfork.content.world.studio.repository.CardCategoryRepository
import ai.storyfork.content.world.studio.repository.SettingCardDraftRepository
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 세계관 카드 카테고리(카드 유형)의 정본 관리다. 장르(DEC-56)와 같은 방식으로 공개 목록은 숨김까지 담고 운영은 추가·이름·아이콘·순서·숨김을 바꾸며 삭제는 없다(카드가 코드로 참조한다).
 * 쓰기는 모든 행을 잠근 WorldStudio 트랜잭션 하나에서 검사·저장하고 응답은 커밋 뒤에 만든다.
 */
@Service
class CardCategoryService(
    private val categories: CardCategoryRepository, private val cardDrafts: SettingCardDraftRepository,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager)
    private val inOrder = Sort.by("position", "code")

    /** 숨김 포함 전체 카테고리를 표시 순서대로 돌려준다(비로그인 공개 목록). */
    fun publicList(): List<PublicCardCategoryResponse> = categories.findAll(inOrder).map { PublicCardCategoryResponse(it.code, it.name, it.icon, it.position, it.active) }

    /** 숨김 포함 전체 카테고리를 표시 순서대로 돌려준다. 사용 수는 집계 쿼리 한 번이다. */
    fun list(): List<CardCategoryResponse> {
        val counts = cardDrafts.cardCounts().associate { it[0] as String to (it[1] as Number).toInt() }
        return categories.findAll(inOrder).map { it.response(counts[it.code] ?: 0) }
    }

    /** 새 카테고리를 맨 뒤 순서의 활성 카테고리로 만든다. 코드는 `category-NN`(장르 코드와 같은 번호 부여)이다. */
    fun create(request: CardCategoryCreateRequest): CardCategoryResponse {
        val name = genreName(request.name, "카테고리")
        val icon = genreEmoji(request.icon)
        // ponytail: 두 운영자가 동시에 추가하면 같은 번호가 PK 충돌(500)로 끝난다. 운영자 한 명이 쓰는 화면이라 잠금용 행을 두지 않는다.
        val created = transaction.execute {
            val all = categories.lockAll()
            checkNameFree(all, name, null)
            CardCategory(nextNumberedCode("category", all.map { it.code }), name, icon, true, (all.maxOfOrNull { it.position } ?: 0) + 1).also { categories.saveAndFlush(it) }
        }!!
        return created.response(0)
    }

    /** 보낸 필드만 바꾼다. 기본 8종도 이름·아이콘·숨김을 바꿀 수 있다(코드는 그대로다). */
    fun update(code: String, request: CardCategoryUpdateRequest): CardCategoryResponse {
        val name = request.name?.let { genreName(it, "카테고리") }
        val icon = request.icon?.let { genreEmoji(it) }
        transaction.execute {
            val all = categories.lockAll()
            val row = all.singleOrNull { it.code == code } ?: throw ContentFailure(404, "카테고리를 찾을 수 없어요.")
            if (name != null) { checkNameFree(all, name, row); row.name = name }
            if (request.icon != null) row.icon = icon
            request.active?.let { row.active = it }
            categories.saveAndFlush(row)
        }
        return list().first { it.code == code }
    }

    /** 표시 순서를 바꾼다. [CardCategoryOrderRequest.codes]는 숨긴 카테고리를 포함한 전체 코드를 한 번씩 담아야 하며 어긋나면 422다. */
    fun reorder(request: CardCategoryOrderRequest): List<CardCategoryResponse> {
        transaction.execute {
            val all = categories.lockAll()
            val codes = request.codes.orEmpty()
            checkContent(codes.size == all.size && codes.toSet() == all.map { it.code }.toSet(), message = "순서에는 모든 카테고리 코드를 한 번씩 담아 주세요.")
            val byCode = all.associateBy { it.code }
            codes.forEachIndexed { index, code -> byCode.getValue(code).position = index + 1 }
            categories.flush()
        }
        return list()
    }

    /** [name]을 쓰는 다른 카테고리가 없는지 본다([self]는 제외). 같은 이름 두 개는 DB UNIQUE도 막지만 먼저 409로 알린다. */
    private fun checkNameFree(all: List<CardCategory>, name: String, self: CardCategory?) {
        if (all.any { it !== self && it.name == name }) throw ContentFailure(409, "이미 있는 카테고리 이름이에요.", "CARD_CATEGORY_NAME_TAKEN")
    }

    private fun CardCategory.response(cardCount: Int) = CardCategoryResponse(code, name, icon, active, position, cardCount)
}
