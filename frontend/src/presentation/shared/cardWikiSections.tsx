import type { ReactNode } from 'react'
import { CardMarkdown, type CardLinkRender } from './CardMarkdown'
import { numberCardSections, splitCardSections } from './cardSections'

/*
 * 설정 카드 위키 문서(`cardWiki`)의 문단 만들기: 본문 제목·관계·목록을 번호 매긴 문단 트리로 바꾸는 순수 규칙이다.
 * 컴포넌트는 `cardWiki.tsx`가 맡고(한 파일이 컴포넌트와 함수를 함께 내보내면 Fast refresh가 그 파일을 통째로 새로 불러온다) 이 파일은 함수와 타입만 내보낸다.
 */

/** [id]는 문단 제목(summary)의 DOM id다. [heading]이 있으면 제목 자리에 그 요소를 그리고(관계 문단의 상대 카드 링크) [title]은 목차 글자다. */
export type WikiSection = { id: string; no: string; depth: number; title: string; heading?: ReactNode; body: ReactNode; children: WikiSection[] }
/** 관계 문단(`관계` 아래 하위 문단)과 목록 문단(최상위): 호출하는 쪽이 제목·링크를 그려 넘긴다. */
export type WikiRelation = { id: string; title: string; heading: ReactNode; body: ReactNode }
export type WikiList = { id: string; title: string; body: ReactNode }

/**
 * 문단: 본문(마크다운)의 `#`·`##`·`###` 제목마다 한 문단(단계대로 `1`·`1.1`·`1.1.1`, 하위 문단은 상위 문단 안) → 관계(관계마다 하위 문단, 다음 번호) → 목록 문단(최상위, 번호를 이어 받음).
 * 첫 제목 앞의 글은 제목 없는 첫머리(`lead`)라 목차·번호에 넣지 않는다(개요를 지어 붙이지 않는다). `####` 이하는 문단 본문 안의 소제목이고 내용이 없는 문단은 빠진다(`splitCardSections`가 정한다).
 */
export function wikiSections(text: string, relations: readonly WikiRelation[], lists: readonly WikiList[], cardLink: CardLinkRender): { lead: string; sections: WikiSection[] } {
  const parts = splitCardSections(text)
  const written = numberCardSections(parts)
  const top = written.filter((s) => s.depth === 1).length
  const hasRelations = relations.length > 0
  const flat: WikiSection[] = [
    ...written.map(({ title, body, no, depth }, i) => ({ id: `nw-s-text-${i}`, no, depth, title, body: body && <CardMarkdown text={body} cardLink={cardLink} />, children: [] })),
    ...(hasRelations ? [{ id: 'nw-s-relations', no: String(top + 1), depth: 1, title: '관계', body: null, children: [] }] : []),
    ...relations.map((r, i): WikiSection => ({ id: r.id, no: `${top + 1}.${i + 1}`, depth: 2, title: r.title, heading: r.heading, body: r.body, children: [] })),
    ...lists.map((l, i) => ({ id: `nw-s-${l.id}`, no: String(top + (hasRelations ? 1 : 0) + i + 1), depth: 1, title: l.title, body: l.body, children: [] })),
  ]
  // 단계(depth)대로 앞 문단의 하위로 넣는다. 번호를 매길 때 단계가 한 칸씩만 깊어지므로 부모는 늘 바로 앞 단계다.
  const sections: WikiSection[] = []
  const path: WikiSection[] = []
  for (const s of flat) {
    path.length = s.depth - 1
    ;(path.at(-1)?.children ?? sections).push(s)
    path.push(s)
  }
  return { lead: parts[0]?.level === 0 ? parts[0].body : '', sections }
}
