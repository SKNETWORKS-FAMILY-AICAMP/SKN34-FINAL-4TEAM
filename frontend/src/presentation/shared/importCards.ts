import type { PublicWorld, PublicWorldSummary } from '../../domain/entities/publicWorld'
import { cardTypePatch } from '../../domain/entities/studioCards'
import { applyRelationChanges, type RelationInput } from '../../domain/entities/studioRelations'
import { authorEdit, newSetting, type StudioSetting } from '../../domain/entities/studioWorld'

/*
 * 설정 가져오기(DEC-46): 공개 세계관의 확정 버전에 있는 공개 카드를 골라 내 세계관 초안에 새 카드로 복사한다. 서버 API 없이 공개 상세 응답을 복사하고,
 * 기존 '세계관 저장'으로 반영한다. 원본의 이후 변경·비공개 전환·삭제는 따라가지 않는다(참조가 아니라 복사다).
 */

/** 서버가 한 세계관에 두는 활성 설정 카드 수의 한도 */
const CARD_LIMIT = 1000

/** 가져올 카드(새 id)와 그 사이의 관계 입력. 관계는 `appendImported`가 기존 관계 저장 규칙으로 만든다. */
export type ImportedSettings = { cards: StudioSetting[]; relations: RelationInput[] }

/** 가져온 카드의 출처 한 줄. 게시판 행과 편집 화면이 같은 문구를 쓴다. */
export const importedSource = ({ worldName, authorNickname }: NonNullable<StudioSetting['importedFrom']>) => `참고: ${worldName} 세계관 · ${authorNickname}`

/** 가져올 수 있는 공개 세계관: 대상 세계관 자신은 뺀다(자기 설정을 자기에게 복사하지 않는다). */
export const importableWorlds = (worlds: readonly PublicWorldSummary[], targetWorldId: string) => worlds.filter((world) => world.id !== targetWorldId)

/**
 * 고른 공개 카드를 새 id의 설정으로 복사한다: 제목·본문·유형·별칭·태그를 지키고 출처(원본 세계관·작가·확정 버전·원본 카드)를 기록하며,
 * 비공개·독자 공개 회차 없음으로 시작한다(작가가 직접 쓴 카드와 같은 모양이라 그대로 고칠 수 있다).
 * `withRelations`이면 양 끝을 모두 가져온 관계만 새 카드 id로 이어 넘긴다. 같은 두 카드의 같은 이름 관계는 한 번만, 자기 자신을 잇는 관계는 버린다.
 * ponytail: 공개 상세는 관계의 이름(label)만 준다. 방향·종류·부정 여부를 알 수 없어 원본의 양 끝 순서를 지킨 '직접 쓴 방향 관계'로 옮긴다. 공개 API가 방향·종류를 주게 되면 그대로 옮긴다.
 */
export function importCards(source: PublicWorld, selectedIds: ReadonlySet<string>, withRelations: boolean): ImportedSettings {
  const picked = source.cards.filter((card) => selectedIds.has(card.id))
  const cards = picked.map((card): StudioSetting => {
    const base = newSetting()
    return {
      ...authorEdit(base, { ...cardTypePatch(base.item, card.cardType, []), title: card.title, text: card.text }),
      tags: [...card.tags], aliases: [...card.aliases],
      importedFrom: { worldId: source.id, worldName: source.name, authorNickname: source.authorNickname, revisionNo: source.revisionNo, cardId: card.id },
    }
  })
  if (!withRelations) return { cards, relations: [] }
  const copied = new Map(picked.map((card, i) => [card.id, cards[i].item.id]))
  const seen = new Set<string>()
  const relations = source.relationships.flatMap((relation): RelationInput[] => {
    const subjectId = copied.get(relation.sourceCardId), targetId = copied.get(relation.targetCardId), label = relation.label.trim()
    const key = `${subjectId}>${targetId}>${label}`
    if (!subjectId || !targetId || subjectId === targetId || seen.has(key)) return []
    seen.add(key)
    return [{ subjectId, targetId, predicate: 'custom_relation_directed', polarity: 'asserted', ...(label && { title: label.slice(0, 200), text: label }) }]
  })
  return { cards, relations }
}

/**
 * 가져온 카드를 초안 끝에 더하고 관계를 기존 관계 규칙(`applyRelationChanges`)으로 만든다. 서버 한도를 넘기면 아무것도 더하지 않고 이유를 던진다.
 * `baseline`은 저장된 설정이다(이미 저장된 중복 관계는 그대로 둔다).
 */
export function appendImported(settings: StudioSetting[], { cards, relations }: ImportedSettings, baseline: StudioSetting[] = settings): StudioSetting[] {
  const room = CARD_LIMIT - settings.filter((setting) => setting.item.kind !== 'relation').length
  if (cards.length > room) throw new Error(`설정 카드는 1,000개까지 저장할 수 있어요. ${room > 0 ? `지금은 ${room}개까지 가져올 수 있어요.` : '더 가져오려면 설정을 먼저 정리해 주세요.'}`)
  return applyRelationChanges([...settings, ...cards], relations, [], baseline)
}
