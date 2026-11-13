import type { CardVisibility, StudioSetting } from '../../../../domain/entities/studioWorld'
import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'

/*
 * 설정 카드 단위 공개(DEC-46): 카드는 기본 비공개이고, 공개 세계관 화면에는 확정 버전의 공개 카드만 보인다.
 * 게시판의 선택 공개·선택 비공개·전체 공개와 편집 화면의 공개 토글이 같은 규칙을 쓴다.
 */

/** 공개 화면에 보일 수 있는 설정 수: 공개로 둔 카드다(관계 행은 카드가 아니다). */
export const publicCardCount = (settings: readonly StudioSetting[]) => settings.filter((s) => s.item.kind !== 'relation' && s.visibility === 'public').length

/**
 * 고른 카드의 공개 범위를 바꾼 설정 목록. 비공개는 값을 지운다(없으면 비공개). 관계 행과 이미 그 값인 카드는 그대로 두고,
 * 바뀐 카드가 하나도 없으면 받은 배열을 그대로 돌려줘 저장할 변경을 만들지 않는다.
 */
export function setCardVisibility(settings: StudioSetting[], ids: ReadonlySet<string>, visibility: CardVisibility): StudioSetting[] {
  let changed = false
  const next = settings.map((setting) => {
    if (!ids.has(setting.item.id) || setting.item.kind === 'relation' || (setting.visibility ?? 'private') === visibility) return setting
    changed = true
    const { visibility: _, ...rest } = setting
    return visibility === 'public' ? { ...rest, visibility } : rest
  })
  return changed ? next : settings
}

/** `전체 공개`: 설정집의 카드를 모두 공개로 바꾼다(집필 메모·분류 확인 항목·관계는 건드리지 않는다). 이미 모두 공개면 받은 배열 그대로다. */
export const publishAllCards = (settings: StudioSetting[]) => setCardVisibility(settings, new Set(cardLibraryRows(settings, 'all', '').map((s) => s.item.id)), 'public')
