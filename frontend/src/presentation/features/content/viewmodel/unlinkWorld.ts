import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

/** 연결 해제 요청의 옵션(결정 4): `makePrivate`가 있으면 세계관을 먼저 비공개로 바꾸고(장르는 [genre] 그대로) 해제한다. 있으면 연결 해제 경고 대화 상자가 이미 확인을 받은 것이다. */
export type WorldRelease = { makePrivate?: { genre: string | null } }

/**
 * 공개 세계관을 비공개로 바꾸고 소설과의 연결을 해제한다(결정 4): 해제하면 작가 전용이던 카드까지 모두 공개되므로 비공개를 먼저 보내고, 성공했을 때만 해제를 보낸다.
 * 비공개가 실패하면 그 오류를 던져 해제하지 않는다(서버 문구가 그대로 화면에 간다). 장르는 현재 값 그대로 보낸다. 새 서버 API 없이 기존 공개 설정·연결 요청 그대로다.
 * 두 요청에 같은 취소 신호([signal], 화면을 떠나면 ViewModel이 취소한다)를 넘기고, 취소 신호를 모르는 저장소여도 비공개 응답 뒤 이미 취소됐으면 해제를 보내지 않고 취소(AbortError)로 던진다.
 */
export async function privateThenUnlink(episodes: Pick<EpisodeUseCase, 'linkWorldStudio'>, worlds: Pick<WorldStudioUseCase, 'setPublication'>, work: { id: string; worldId: string }, genre: string | null, signal: AbortSignal) {
  await worlds.setPublication(work.worldId, { visibility: 'private', genre }, signal)
  signal.throwIfAborted()
  return episodes.linkWorldStudio(work.id, null, signal)
}
