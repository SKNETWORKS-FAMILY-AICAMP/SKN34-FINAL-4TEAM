package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.CreateWorldRequest
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.SaveWorldRequest
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.annotation.Order
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper

/**
 * 서버 시작 시 `genre-templates.json`의 장르 템플릿을 [TEMPLATE_OWNER](Core 운영 관리자) 소유 WorldStudio 세계관으로 적재한다.
 * Neo4j 노드가 필요해 SQL로는 넣을 수 없으므로 기존 [WorldStudioService]의 create → edit → save를 그대로 호출한다.
 * worldId·key가 고정이라 시작할 때마다 다시 시도해도 안전하고, 한 장르가 실패(Neo4j 장애 등)해도 로그만 남기고 서버와 다음 장르는 계속 간다.
 * 리소스 JSON을 읽지 못해도 로그만 남기고 서버는 계속 뜬다(그 시작에서는 적재 없음).
 *
 * 최초·v2 입력은 재시도 hash 보존을 위해 동결한다. SOUL 보완은 초기 샘플과 저장 이력이 일치할 때만 별도 key로 적용한다.
 */
@Component
class GenreTemplateSeeder(private val service: WorldStudioService, private val mapper: JsonMapper) {
    private val log = LoggerFactory.getLogger(GenreTemplateSeeder::class.java)

    @EventListener(ApplicationReadyEvent::class)
    @Order(0)
    fun seed() {
        // 리소스를 못 읽어도 ApplicationReadyEvent 예외로 서버 기동이 실패하지 않게 로그만 남기고 돌아온다.
        val templates = try { loadLegacy() }
            catch (e: Exception) { log.error("장르 템플릿 리소스 읽기 실패: {}: {}", e.javaClass.simpleName, e.message); return }
        val frozen = try { loadV2().associateBy { it.worldId } }
            catch (e: Exception) { log.error("템플릿 보완 리소스 읽기 실패", e); null }
        val updated = frozen.orEmpty()
        val loadedCurrent = try { load().associateBy { it.worldId } }
            catch (e: Exception) { log.error("최신 템플릿 리소스 읽기 실패", e); null }
        val current = loadedCurrent.orEmpty()
        val legacyIds = templates.map { it.worldId }.toSet()
        val legacyById = templates.associateBy { it.worldId }
        if (frozen != null && loadedCurrent != null) for (id in legacyIds + updated.keys + current.keys) {
            if ((id in legacyIds && id !in updated) || (id in updated && id !in current)) {
                log.error("템플릿 공개 판정 보류 world={}: 동결 리소스 누락",id);continue
            }
            try { service.publishPristineTemplate(legacyById[id], updated[id], current[id]) }
            catch (e: Exception) { log.error("기존 템플릿 공개 판정 실패 world={}: {}: {}", id, e.javaClass.simpleName, e.message) }
        }
        for (template in templates) {
            try { seedGenre(template) }
            catch (e: Exception) { log.error("장르 템플릿 적재 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
            val target = updated[template.worldId] ?: continue
            try { GenreTemplateRepair(service).repair(template, target) }
            catch (e: Exception) { log.error("장르 템플릿 보완 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
        }
        if (frozen == null) return
        for (template in updated.values.filter { it.worldId !in legacyIds }) {
            try { seedGenre(template, legacy = false) }
            catch (e: Exception) { log.error("신화 템플릿 적재 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
        }
        for (baseline in updated.values) {
            val target = current[baseline.worldId]
            if (target == null) { log.error("SOUL 템플릿 누락 genre={}", baseline.genre); continue }
            try { GenreTemplateRepair(service).repairSoul(legacyById[baseline.worldId], baseline, target) }
            catch (e: Exception) { log.error("SOUL 보완 실패 genre={}: {}: {}", baseline.genre, e.javaClass.simpleName, e.message) }
        }
        for (template in current.values.filter { it.worldId !in updated && it.worldId !in legacyIds }) {
            try { seedGenre(template, legacy = false, soul = true) }
            catch (e: Exception) { log.error("신규 템플릿 적재 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
        }
    }

    internal fun load(): List<GenreTemplate> =
        ClassPathResource("genre-templates.json").inputStream.use { mapper.readValue(it, Array<GenreTemplate>::class.java).toList() }

    internal fun loadLegacy(): List<GenreTemplate> =
        ClassPathResource("genre-templates-v1.json").inputStream.use { mapper.readValue(it, Array<GenreTemplate>::class.java).toList() }

    internal fun loadV2(): List<GenreTemplate> =
        ClassPathResource("genre-templates-v2.json").inputStream.use { mapper.readValue(it, Array<GenreTemplate>::class.java).toList() }

    private fun seedGenre(template: GenreTemplate, legacy: Boolean = true, soul: Boolean = false) {
        val key = "genre-template-${template.genre}"
        val genre = mappedWorldGenre(template.genre)
        service.fillTemplateGenre(template.worldId, genre)
        // create: 같은 id·같은 입력이면 기존 세계관을 돌려준다. 앞선 edit가 미완료로 남은 세계관은 INCOMPLETE라 아래 edit 재시도로 이어 간다.
        val world = try { service.createTemplate(CreateWorldRequest(template.name, template.description, template.worldId), genre) }
            catch (e: WorldStudioFailure) { if (e.reason == WorldStudioFailure.Reason.INCOMPLETE) null else throw e }
        // save가 draft revision을 올려 같은 edit의 중복 판정이 깨지므로, 저장까지 끝난 세계관은 다시 edit하지 않는다.
        if (world?.currentRevisionId != null) return
        // 템플릿 카드와 새 템플릿 세계관은 공개다. 기존 세계관은 위의 별도 원본 판정에서만 공개한다.
        val cards = if (legacy) template.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public") }
            else if (soul) GenreTemplateRepair.soulPayloads(template) else GenreTemplateRepair.payloads(template)
        val edited = service.edit(template.worldId, TEMPLATE_OWNER, EditWorldDraftRequest(0, template.name, template.description, cards, key = key))
        service.save(template.worldId, TEMPLATE_OWNER, SaveWorldRequest(edited.draftRevision, key))
    }

    companion object {
        /**
         * 템플릿 키 → Content 장르 코드(DEC-56, WorldStudio V14가 옛 영문 코드를 같은 표로 바꾼다: fantasy→genre-01, wuxia→genre-03, romance→genre-06,
         * modern→genre-10, sf→genre-14, mystery→genre-18, classic→genre-28). 이미 적재된 세계관의 장르가 이 값과 같아야 원본 판정(`pristineTemplate`)을 계속 통과하므로
         * 옛 매핑을 값만 바꿔 따라가고, 더 잘게 나누려면 V14의 변환 표와 함께 바꾼다. 이 값은 시스템이 정하므로 활성 여부는 확인하지 않는다.
         */
        private val TEMPLATE_WORLD_GENRES = mapOf(
            "wuxia" to "genre-03", "romance_fantasy" to "genre-06",
            "modern_fantasy" to "genre-01", "game_fantasy" to "genre-01", "fusion_fantasy" to "genre-01",
            "territory_management" to "genre-01", "sports_fantasy" to "genre-01",
            "science_fiction" to "genre-14", "apocalypse" to "genre-14", "entertainment" to "genre-10",
            "cthulhu_mythos" to "genre-18",
            "alternate_history" to "genre-28", "sumerian_mythology" to "genre-28", "norse_mythology" to "genre-28",
            "greco_roman_mythology" to "genre-28", "germanic_folklore" to "genre-28", "chinese_folklore" to "genre-28",
            "japanese_mythology" to "genre-28", "korean_mythology_fables" to "genre-28", "egyptian_mythology" to "genre-28",
            "indian_mythology" to "genre-28", "celtic_mythology" to "genre-28", "slavic_mythology" to "genre-28",
            "maya_mythology" to "genre-28", "aztec_mythology" to "genre-28", "hawaiian_tradition" to "genre-28",
            "inca_tradition" to "genre-28", "persian_tradition" to "genre-28", "journey_to_the_west" to "genre-28",
            "england_history" to "genre-28", "usa_history" to "genre-28", "china_history" to "genre-28",
            "korea_history" to "genre-28", "japan_history" to "genre-28", "france_history" to "genre-28", "italy_history" to "genre-28",
        )

        /** 템플릿 키를 공개 세계관의 Content 장르 코드로 바꾼다. 알 수 없는 키는 미지정(null)으로 둔다. */
        internal fun mappedWorldGenre(templateGenre: String): String? = TEMPLATE_WORLD_GENRES[templateGenre]

        /**
         * 템플릿 세계관 소유자: Core auth V8 운영 관리자(admin@example.test, operator=true)의 회원 UUID. 운영자로 로그인하면 세계관 목록에 보인다.
         * 임시 할당이며 한계는 다음과 같다.
         * ① V8 샘플 관리자 비밀번호가 마이그레이션 주석에 공개돼 있어 그 계정으로 로그인하면 누구나 템플릿을 수정·삭제할 수 있다.
         *   실제 운영 계정·공개 템플릿 조회가 생기면 소유자를 바꾼다.
         * ② V8은 `ON CONFLICT (email) DO NOTHING`이라 기존 DB에 admin@example.test가 다른 id로 있으면 이 UUID가 실제 로그인 계정과 다를 수 있다.
         * ③ 기존 비공개 템플릿은 소유자가 공개하기 전까지 다른 사용자에게 보이지 않는다.
         * 소유자를 바꿔도 이미 적재된 세계관은 새 소유자로 옮겨지지 않는다(고정 worldId의 create가 소유자 불일치로 거절되어 장르별 오류 로그만 남는다).
         */
        val TEMPLATE_OWNER: UUID = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    }
}

internal data class GenreTemplate(val genre: String, val worldId: UUID, val name: String, val description: String, val cards: List<GenreTemplateCard>)
internal data class GenreTemplateCard(val id: UUID, val title: String, val body: String, val cardType: String, val soul: String? = null)
