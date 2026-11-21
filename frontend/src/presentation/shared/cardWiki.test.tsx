// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CardWikiBody, InfoRow, WikiInfoBox } from './cardWiki'
import { wikiSections } from './cardWikiSections'

afterEach(cleanup)

const relation = (id: string, title: string) => ({ id, title, heading: <b>{title}</b>, body: <p>{title} 설명</p> })

it('wikiSections: 본문 제목마다 번호 문단(1·1.1)이고, 관계는 다음 번호(하위는 관계 안), 목록은 그다음 번호이며, 첫 제목 앞 글은 목차에 넣지 않는 첫머리다', () => {
  const { lead, sections } = wikiSections('첫머리 글\n# 가\n가 본문\n## 가-1\n하위 본문\n# 나\n나 본문', [relation('r1', '상대 — 친구'), relation('r2', '상대 — 동료')], [{ id: 'same', title: '같은 유형의 다른 설정', body: <ul /> }], () => undefined)
  expect(lead).toBe('첫머리 글')
  expect(sections.map((s) => [s.no, s.title, s.children.map((c) => [c.no, c.title])])).toEqual([
    ['1', '가', [['1.1', '가-1']]],
    ['2', '나', []],
    ['3', '관계', [['3.1', '상대 — 친구'], ['3.2', '상대 — 동료']]],
    ['4', '같은 유형의 다른 설정', []],
  ])
  expect(sections[2].id).toBe('nw-s-relations')
  expect(sections[3].id).toBe('nw-s-same')
})

it('wikiSections: 관계도 목록도 없고 본문에 제목이 없으면 문단이 없다(개요를 지어 붙이지 않는다)', () => {
  const { lead, sections } = wikiSections('제목 없는 본문', [], [], () => undefined)
  expect([lead, sections]).toEqual(['제목 없는 본문', []])
})

it('CardWikiBody: 번호 목차(하위는 들여 씀)·첫머리·접이식 문단을 그리고, 접을 문단(fold)들은 `관계 자세히 보기 (N)` 한 묶음에 든다', () => {
  const { lead, sections } = wikiSections('첫머리\n# 가\n본문 가', [relation('r1', '상대 — 친구')], [], () => undefined)
  render(<CardWikiBody lead={lead} sections={sections} fold={['nw-s-relations']} foldCount={1} cardLink={() => undefined} />)
  const toc = screen.getByRole('navigation', { name: '목차' })
  expect(within(toc).getAllByRole('listitem').map((li) => li.querySelector('a')!.textContent)).toEqual(['1. 가', '2. 관계', '2.1. 상대 — 친구'])
  expect(screen.getByText('첫머리')).toBeTruthy()
  const rels = document.querySelector('details.nw-rels')!
  expect(rels.querySelector('summary')!.textContent).toBe('관계 자세히 보기 (1)')
  expect((rels as HTMLDetailsElement).open).toBe(false) // 기본으로 접혀 있다
  expect(within(rels as HTMLElement).getByText('상대 — 친구 설명')).toBeTruthy()
  expect(document.querySelectorAll('details.nw-sec')).toHaveLength(3) // 가 · 관계 · 상대 — 친구(하위 문단은 상위 안)
  expect(document.querySelector('details.nw-sec')!.hasAttribute('open')).toBe(true)
})

it('CardWikiBody: 문단이 없으면 목차도 없다', () => {
  render(<CardWikiBody lead="" sections={[]} fold={[]} foldCount={0} cardLink={() => undefined} />)
  expect(screen.queryByRole('navigation', { name: '목차' })).toBeNull()
})

it('WikiInfoBox: 유형 색 띠 아래 카드 이름(caption)과 행들이고, 이미지는 있을 때만 맨 위 행으로 든다', () => {
  const { rerender } = render(<WikiInfoBox kind="인물" title="가람"><InfoRow k="별칭">서약사</InfoRow></WikiInfoBox>)
  const table = document.querySelector<HTMLElement>('table.nw-info')!
  expect(table.style.getPropertyValue('--cat')).toBe('#67caff')
  expect(table.querySelector('caption')!.textContent).toBe('가람')
  expect(table.querySelector('.nw-info-image')).toBeNull()
  expect(within(table).getByRole('rowheader', { name: '별칭' }).nextElementSibling!.textContent).toBe('서약사')
  rerender(<WikiInfoBox kind="장소" title="항구" image={<span role="img" aria-label="항구 이미지" />}><InfoRow k="유형">장소</InfoRow></WikiInfoBox>)
  expect(table.style.getPropertyValue('--cat')).toBe('#6ce3cb')
  expect(table.querySelector('tbody')!.firstElementChild!.classList.contains('nw-info-image')).toBe(true)
  expect(within(table).getByRole('img', { name: '항구 이미지' })).toBeTruthy()
})
