import { vi } from 'vitest'

import { seedWorks } from '../data/mock/seed'
import type { SerialBoardRecord, SerialBoardView, SerialChoice, SerialProposal, SerialSettings } from '../domain/entities/aiSerial'
import type { SerialRepository } from '../domain/repositories/SerialRepository'

/** AI 자율 연재 테스트 공용 값과 저장소 대역: 읽기는 준 값을 그대로 돌려주고 쓰기는 성공한다(실패는 테스트가 mockRejectedValue로 만든다). */
export const settings = (extra: Partial<SerialSettings> = {}): SerialSettings => ({ enabled: true, days: ['MON', 'THU'], time: '21:00', direction: '밝은 분위기로', ...extra })
export const record = (extra: Partial<SerialBoardRecord> = {}): SerialBoardRecord => ({ id: 'b1', episodeNumber: 4, status: 'open', publishedEpisodeNumber: null, failureReason: null, closedAt: null, ...extra })
export const choice = (extra: Partial<SerialChoice> = {}): SerialChoice => ({ id: 'c1', position: 1, text: '주인공이 편지를 열어 본다', votes: 3, ...extra })
/** 선택지 4개(번호 1~4). 득표는 3·0·1·2다. */
export const fourChoices = (): SerialChoice[] => [
  choice(),
  choice({ id: 'c2', position: 2, text: '편지를 불태운다', votes: 0 }),
  choice({ id: 'c3', position: 3, text: '편지를 들고 마을을 떠난다', votes: 1 }),
  choice({ id: 'c4', position: 4, text: '편지의 주인을 찾아 나선다', votes: 2 }),
]
export const proposal = (extra: Partial<SerialProposal> = {}): SerialProposal => ({
  id: 'p1', authorName: '독자A', kind: 'general', title: '반전이 좋겠어요', body: '편지의 주인이 사실 죽은 줄 알았던 동생이면 어떨까요?', simulation: null,
  likes: 3, likedByMe: false, mine: false, createdAt: '2026-11-22T01:00:00Z', ...extra,
})
export const board = (extra: Partial<SerialBoardView> = {}): SerialBoardView => ({
  enabled: true, board: { id: 'b9', episodeNumber: 5 }, choices: fourChoices(), myChoiceId: null, proposals: [proposal()], summary: null, ...extra,
})
export const fakeSerialRepo = ({ saved = settings(), rows = [record()], view = board() }: { saved?: SerialSettings; rows?: SerialBoardRecord[]; view?: SerialBoardView } = {}) => ({
  settings: vi.fn(async () => saved), saveSettings: vi.fn(async () => {}), run: vi.fn(async () => {}), boards: vi.fn(async () => rows), board: vi.fn(async () => view),
  submitProposal: vi.fn(async () => {}), vote: vi.fn(async () => {}), cancelVote: vi.fn(async () => {}),
  likeProposal: vi.fn(async () => {}), unlikeProposal: vi.fn(async () => {}), hideProposal: vi.fn(async () => {}),
}) satisfies SerialRepository
/** 서버(정본) 작품: 소유자 회원 ID는 member-1이다. */
export const serverWork = { ...seedWorks(0).find((w) => w.id === 'postman')!, canonical: true, owner: 'member-1', mine: false }
