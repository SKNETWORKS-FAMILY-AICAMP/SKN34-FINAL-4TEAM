import { vi } from 'vitest'

import { seedWorks } from '../data/mock/seed'
import type { SerialBoardRecord, SerialBoardView, SerialOpinion, SerialSettings } from '../domain/entities/aiSerial'
import type { SerialRepository } from '../domain/repositories/SerialRepository'

/** AI 자율 연재 테스트 공용 값과 저장소 대역: 읽기는 준 값을 그대로 돌려주고 쓰기는 성공한다(실패는 테스트가 mockRejectedValue로 만든다). */
export const settings = (extra: Partial<SerialSettings> = {}): SerialSettings => ({ enabled: true, days: ['MON', 'THU'], time: '21:00', direction: '밝은 분위기로', ...extra })
export const record = (extra: Partial<SerialBoardRecord> = {}): SerialBoardRecord => ({ id: 'b1', episodeNumber: 4, status: 'open', publishedEpisodeNumber: null, failureReason: null, closedAt: null, ...extra })
export const opinion = (extra: Partial<SerialOpinion> = {}): SerialOpinion => ({ id: 'o1', authorName: '독자A', kind: 'general', body: '반전이 좋겠어요', simulation: null, votes: 3, createdAt: '2026-11-22T01:00:00Z', ...extra })
export const board = (extra: Partial<SerialBoardView> = {}): SerialBoardView => ({ board: { id: 'b9', episodeNumber: 5 }, opinions: [opinion()], myOpinionId: null, myVoteOpinionId: null, summary: null, ...extra })
export const fakeSerialRepo = ({ saved = settings(), rows = [record()], view = board() }: { saved?: SerialSettings; rows?: SerialBoardRecord[]; view?: SerialBoardView } = {}) => ({
  settings: vi.fn(async () => saved), saveSettings: vi.fn(async () => {}), run: vi.fn(async () => {}), boards: vi.fn(async () => rows), board: vi.fn(async () => view),
  submitOpinion: vi.fn(async () => {}), vote: vi.fn(async () => {}), cancelVote: vi.fn(async () => {}), hideOpinion: vi.fn(async () => {}),
}) satisfies SerialRepository
/** 서버(정본) 작품: 소유자 회원 ID는 member-1이다. */
export const serverWork = { ...seedWorks(0).find((w) => w.id === 'postman')!, canonical: true, owner: 'member-1', mine: false }
