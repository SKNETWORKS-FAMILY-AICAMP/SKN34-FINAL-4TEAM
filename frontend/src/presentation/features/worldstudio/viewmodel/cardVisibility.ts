import { cardRevealEpisode, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'

/*
 * 설정 카드의 공개 설정은 하나다(DEC-53): 'N화부터 공개' 또는 '작가 전용'(기본). 서버가 기준 회차 이하로 공개된 카드만 보내므로 화면은 카드를 거르지 않는다(DEC-46).
 * 새 화면은 `revealFromEpisode`만 정하고 `visibility`는 회차가 있으면 public, 없으면 지워 맞춘다. 게시판의 일괄 공개와 편집 화면의 입력이 같은 함수를 쓴다.
 * 건드리지 않은 카드는 다시 쓰지 않는다: 옛 공개 카드(공개 + 회차 없음)는 읽을 때 1화로 계산되므로 그대로 둔다.
 */

/** 공개 화면에 보일 수 있는 설정 수: 유효 공개 회차가 있는 카드다(관계 행은 카드가 아니다). */
export const publicCardCount = (settings: readonly StudioSetting[]) => settings.filter((s) => s.item.kind !== 'relation' && cardRevealEpisode(s) !== undefined).length
export const visibleSelection = (rows: readonly { cardId: string }[], selected: ReadonlySet<string>) => rows.filter((row) => selected.has(row.cardId)).map((row) => row.cardId)

/** 공개 설정을 보이는 글: 작가 전용 / 소설이 연결되지 않은 세계관의 1화는 `공개` / 그 밖은 `N화부터`. */
export const revealLabel = (episode: number | undefined, linked: boolean) => (episode === undefined ? '작가 전용' : !linked && episode === 1 ? '공개' : `${episode}화부터`)

/**
 * 고른 카드 모두의 공개 회차를 [episode]로 바꾼 설정 목록이다(undefined면 작가 전용). 회차가 있으면 `visibility`를 공개로, 없으면 회차와 `visibility`를 모두 지운다.
 * 관계 행과 이미 그 설정인 카드(유효 공개 회차가 같고 `visibility`도 맞음)는 그대로 두고, 바뀐 카드가 하나도 없으면 받은 배열을 그대로 돌려줘 저장할 변경을 만들지 않는다.
 */
export function setCardReveal(settings: StudioSetting[], ids: ReadonlySet<string>, episode: number | undefined): StudioSetting[] {
  let changed = false
  const next = settings.map((setting) => {
    if (!ids.has(setting.item.id) || setting.item.kind === 'relation') return setting
    if (cardRevealEpisode(setting) === episode && (setting.visibility === 'public') === (episode !== undefined)) return setting
    changed = true
    const { visibility: _visibility, revealFromEpisode: _reveal, ...rest } = setting
    return episode === undefined ? rest : { ...rest, revealFromEpisode: episode, visibility: 'public' as const }
  })
  return changed ? next : settings
}

/** `전체 공개`: 설정집의 카드를 모두 [episode]화부터 공개로 바꾼다(집필 메모·분류 확인 항목·관계는 건드리지 않는다). 이미 모두 그 설정이면 받은 배열 그대로다. */
export const publishAllCards = (settings: StudioSetting[], episode: number) => setCardReveal(settings, new Set(cardLibraryRows(settings, 'all', '').map((s) => s.item.id)), episode)
