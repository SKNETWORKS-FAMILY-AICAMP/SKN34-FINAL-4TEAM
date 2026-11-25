package ai.storyfork.content.world

import ai.storyfork.content.work.repository.GenreRepository
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/**
 * 카드 유형(카테고리) 검사다. DB의 CHECK 대신 서비스가 card_category 표로 확인한다: 존재하는 코드여야 하고, 새로 정하는 값은 활성이어야 하며,
 * 그 카드가 이미 쓰던 값은 숨긴 카테고리여도 유지할 수 있다. AI·시더가 적용하는 쓰기는 기본 8종을 그대로 저장하므로 존재만 본다.
 */
class CardCategoryValidationTest {
    private val worlds = mock(StudioWorldRepository::class.java)
    private val drafts = mock(WorldDraftRepository::class.java)
    private val cardDrafts = mock(SettingCardDraftRepository::class.java)
    private val states = mock(WorldRelationshipStateRepository::class.java)
    private val cardCategories = mock(CardCategoryRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() } }
    private val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val service = WorldStudioService(worlds, drafts, mock(SettingCardRepository::class.java), cardDrafts, mock(SettingCardVersionRepository::class.java),
        mock(WorldRevisionRepository::class.java), mock(WorldRevisionCardRepository::class.java), mock(WorldSaveRequestRepository::class.java), states,
        mock(TemplatePublicationOnceRepository::class.java), mock(ExpandedSeedProgressRepository::class.java), mock(InitialWorldApplicationRepository::class.java),
        mock(SettingCardImageRepository::class.java), mock(Neo4jRelationshipRepository::class.java), manager, mapper, mock(GenreRepository::class.java),
        mock(ManuscriptBuildJobRepository::class.java), mock(ManuscriptBuildLoadStepRepository::class.java), cardCategories, mock(org.springframework.context.ApplicationEventPublisher::class.java))
    private val world = UUID.randomUUID()
    private val actor = UUID.randomUUID()

    init {
        // 기본 8종(능력은 숨김) + 추가 카테고리 둘(하나는 숨김).
        `when`(cardCategories.findAll()).thenReturn(defaultCardCategories().map { if (it.code == "ability") CardCategory("ability", "능력", null, false, 4) else it } +
            CardCategory("category-01", "추리 단서", null, true, 9) + CardCategory("category-02", "옛 분류", null, false, 10))
    }

    private fun card(type: String, id: UUID = UUID.randomUUID()) = CardPayload(id, "카드", "본문", type, "basic")
    private fun rejected(block: () -> Unit) = assertThrows(IllegalArgumentException::class.java, block).message

    @Test fun `an existing active category is accepted`() {
        service.requireCardCategories(listOf(card("character"), card("category-01"), card("other")), emptyList(), activeOnly = true)
    }

    @Test fun `an unknown code is rejected`() {
        assertEquals("지원하지 않는 카드 유형입니다.", rejected { service.requireCardCategories(listOf(card("claim")), emptyList(), activeOnly = true) })
        assertEquals("지원하지 않는 카드 유형입니다.", rejected { service.requireCardCategories(listOf(card("claim")), emptyList(), activeOnly = false) })
    }

    @Test fun `a hidden category cannot be picked for a new or retyped card but stays for the card that already uses it`() {
        val kept = UUID.randomUUID()
        val retyped = UUID.randomUUID()
        val current = listOf(card("category-02", kept), card("character", retyped))

        service.requireCardCategories(listOf(card("category-02", kept)), current, activeOnly = true)
        assertNotNull(rejected { service.requireCardCategories(listOf(card("category-02", retyped)), current, activeOnly = true) })
        assertNotNull(rejected { service.requireCardCategories(listOf(card("category-02")), current, activeOnly = true) })
        assertNotNull(rejected { service.requireCardCategories(listOf(card("ability")), current, activeOnly = true) })
    }

    @Test fun `AI and seeder writes only need the category to exist so a hidden default type still saves`() {
        service.requireCardCategories(listOf(card("ability"), card("category-02")), emptyList(), activeOnly = false)
    }

    @Test fun `an AI application write passes the category check even for a hidden default type`() {
        `when`(worlds.lockOwned(world, actor)).thenReturn(StudioWorld(world, actor))
        `when`(drafts.findById(world)).thenReturn(Optional.of(WorldDraft(worldId = world, name = "편집본", draftRevision = 2)))
        `when`(states.findById(world)).thenReturn(Optional.of(WorldRelationshipState(world, 3, "creation", "previous", "previous", 1, true)))

        // 분석 반영은 AI가 정한 기본 8종을 그대로 저장한다. 검사를 지나 그래프 읽기(대역이라 null)에서 멈추더라도 카테고리 오류는 아니다.
        val failure = runCatching { service.editAddition(world, actor, EditWorldDraftRequest(2, "편집본", "", listOf(card("ability")), key = "k"), UUID.randomUUID()) }.exceptionOrNull()

        assertNotEquals("지원하지 않는 카드 유형입니다.", failure?.message)
    }

    @Test fun `edit rejects an unsupported card type before touching the graph`() {
        `when`(worlds.lockOwned(world, actor)).thenReturn(StudioWorld(world, actor))
        `when`(drafts.findById(world)).thenReturn(Optional.of(WorldDraft(worldId = world, name = "편집본", draftRevision = 2)))
        `when`(states.findById(world)).thenReturn(Optional.of(WorldRelationshipState(world, 3, "creation", "previous", "previous", 1, true)))

        assertEquals("지원하지 않는 카드 유형입니다.", rejected { service.edit(world, actor, EditWorldDraftRequest(2, "편집본", "", listOf(card("claim")), key = "k")) })
    }
}
