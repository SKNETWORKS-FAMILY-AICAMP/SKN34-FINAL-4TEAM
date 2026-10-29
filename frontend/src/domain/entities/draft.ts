import { epsOf, type Work } from './work'

/** 목업 S.draft 항목: 작성 중인 회차 원고. 키는 작품 id(새 회차) 또는 `${id}:ep:${n}`(발행 회차 수정)입니다. */
export type Draft = {
  no: number
  title: string
  paras: string[]
  authorNote: string
  links: string[]
  sim: unknown
  proposal: unknown
  check: unknown
  saved: boolean
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
