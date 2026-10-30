import { epsOf, type Work } from './work'

/** 목업 S.draft 항목: 작성 중인 회차 원고. 키는 작품 id(새 회차) 또는 `${id}:ep:${n}`(발행 회차 수정)입니다. */
export type Draft = {
  no: number
  title: string
  paras: string[]
  authorNote: string
  links: string[]
  sim: { summary: string } | null
  /** 장면 이어쓰기 제안: shown(미리보기) → accepted(원고에 넣음) */
  proposal: 'shown' | 'accepted' | null
  check: { issues: { sent: string; rule: string; fix: string }[]; stale: boolean; at: number } | null
  saved: boolean
  aiPrompt?: string
  auto?: boolean
  /** 발행 회차 수정 초안: 원본 회차 번호와 열었을 때의 원고 (동시 수정 확인용) */
  editingEpisode?: number
  baseTitle?: string
  baseParas?: string[]
  locked?: boolean
}

export const draftKey = (id: string, episode?: number) => Number.isInteger(episode) && episode! > 0 ? `${id}:ep:${episode}` : id

/** 목업 draftOf(w, n)의 발행 회차 분기 */
export function episodeDraft(w: Work, n: number): Draft {
  const ep = epsOf(w)[n - 1]
  return {
    no: n, title: ep.t, paras: ep.p.slice(), authorNote: ep.authorNote || '', links: [], sim: null, proposal: null, check: null, saved: true,
    editingEpisode: n, baseTitle: ep.t, baseParas: ep.p.slice(), locked: !!(w.parent && n <= (w.forkAt ?? 0)),
  }
}

/** 목업 draftOf(w)의 새 회차 분기 */
export function newEpisodeDraft(w: Work): Draft {
  const n = epsOf(w).length + 1
  return {
    no: n,
    title: w.parent === 'guunmong' && n === (w.forkAt ?? 0) + 1 ? '고백' : '새 회차',
    paras: [], authorNote: '', links: [], sim: null, proposal: null, check: null, saved: true,
  }
}
