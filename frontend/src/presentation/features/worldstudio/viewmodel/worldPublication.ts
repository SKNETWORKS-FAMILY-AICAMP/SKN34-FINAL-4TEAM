import type { StudioWorld, WorldPublication, WorldVisibility } from '../../../../domain/entities/studioWorld'

/** 공개 세계관에는 확정 버전의 공개 카드와 그 사이의 관계만 보이고, 로그인한 사람은 그 카드를 자기 세계관으로 가져갈 수 있다(DEC-46). */
export const PUBLIC_CONFIRM = '공개하면 누구나 공개로 둔 설정 카드와 그 사이의 인물 관계를 볼 수 있고, 로그인한 사람은 자기 세계관으로 가져갈 수 있어요. 공개할까요?'

/** 공개로 설정했지만 확정 버전이 없는 세계관에 보이는 안내. 저장된 상태에서 계산하므로 확정 버전을 남기면 저절로 사라진다. */
export const UNLISTED_HINT = '공개로 설정했지만 아직 확정 버전이 없어 공개 목록에는 나오지 않아요. 저장한 뒤 ‘확정 버전 남기기’로 확정 버전을 한 번 남기면 나타나요.'

/** 비공개에서 공개로 바뀔 때만 한 번 확인한다. 이미 공개인 세계관의 장르만 바꾸거나 비공개로 되돌릴 때는 묻지 않는다. */
export const needsPublicConfirm = (from: WorldVisibility, to: WorldVisibility) => from !== 'public' && to === 'public'

/**
 * 공개 목록·상세에 실제로 나오는지(서버의 `listed`와 같은 조건): 공개이고 확정 버전이 있으면 `listed`, 공개인데 확정 버전이 없으면 `unlisted`(안내가 필요), 그 밖은 null이다.
 * 서버 `listed`는 공개 설정 응답에만 있어 저장된 세계관의 현재 확정 버전 id로 판정한다. 데모(메모리)에는 공개 목록이 없어 null이다.
 */
export const listingOf = (world: Pick<StudioWorld, 'visibility' | 'currentRevisionId'> | null, demo: boolean): 'listed' | 'unlisted' | null =>
  demo || world?.visibility !== 'public' ? null : world.currentRevisionId ? 'listed' : 'unlisted'

/**
 * 공개 설정을 보낸 뒤의 알림. 공개로 설정했어도 확정 버전이 없으면 공개 목록에는 아직 나오지 않지만, 그 설명은 상태에서 계산하는 `UNLISTED_HINT`가 맡는다.
 * 데모(메모리)는 이 화면에만 남고 공개 목록에는 나오지 않는다.
 */
export function publicationNotice(result: WorldPublication, demo: boolean) {
  if (result.visibility === 'private') return '비공개로 바꿨어요. 이제 나만 볼 수 있어요.'
  if (demo) return '공개로 설정했어요 (데모). 이 화면의 메모리에만 있어서 공개 목록에는 나타나지 않고, 새로고침하면 초기화돼요.'
  if (!result.listed) return '공개로 설정했어요.'
  return '공개했어요. 누구나 공개로 둔 설정 카드와 그 사이의 인물 관계를 볼 수 있어요.'
}
