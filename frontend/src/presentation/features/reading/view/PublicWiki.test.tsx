// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReadingWorkRecord, ReadingWorldRecord } from '../../../../data/content/HttpEpisodeRepository'
import { mapReadingWork, withReadingWorld } from '../../../../data/content/readingWork'
import type { ReaderWorldCard, ReaderWorldCards } from '../../../../domain/entities/wiki'
import { worldCardWiki } from '../viewmodel/worldCardWiki'
import { PublicWikiArticle } from './PublicWiki'

// jsdom에는 scrollIntoView·animate가 없다
const scrollIntoView = vi.fn()
const animate = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView
Element.prototype.animate = animate as never
afterEach(() => { cleanup(); vi.clearAllMocks(); Reflect.deleteProperty(window, 'matchMedia') })

const record: ReadingWorkRecord = {
  id: 'work-uuid', slug: null, title: '별빛 서약의 탑', summary: '소개', visibility: 'public', authorName: '윤서하', ownerId: 'owner-uuid',
  revision: 2, theme: 'star', hook: '', hanja: null, hero: null, heroBg: null, genres: ['판타지'], hashtags: [], views: 0, likes: 0,
  allowFork: true, allowForkPublication: true, forkableEpisodes: [2], source: null, episodes: [
    { number: 1, version: 1, versionId: 'v1', title: '하나', body: '첫 문단', inherited: false },
    { number: 2, version: 1, versionId: 'v2', title: '둘', body: '둘째 문단', inherited: false },
  ],
}
const doc = (extra: Partial<ReadingWorldRecord['documents'][number]>): ReadingWorldRecord['documents'][number] => ({
  id: 'doc', versionId: 'v', category: 'char', name: '이름', body: '', aliases: [], tags: [], properties: [], color: '#7C8A9E',
  image: null, episode: null, line: null, participants: [], knowledge: [], links: [], ...extra,
})
/** 서버가 기준 회차까지 공개한 문서만 준다고 보고, 실서비스와 같은 변환(withReadingWorld)으로 화면의 Work를 만든다. */
const served = (documents: ReadingWorldRecord['documents']) => withReadingWorld(mapReadingWork(record), { workId: record.id, episode: 2, documents })

const documents = [
  doc({ id: 'rule', category: 'world', name: '봉인 규칙', body: '해가 지면 탑의 문이 닫힌다.', knowledge: [{ text: '봉인은 새벽에 약해진다', knownAt: 1, publicAt: 2 }] }),
  doc({ id: 'tower', category: 'place', name: '별빛 탑', body: '봉인을 지키는 탑.', tags: ['탑'], links: [{ to: 'rule', kind: '소속' }] }),
  doc({ id: 'night', category: 'event', name: '탑 앞에서 밤을 지새우다', episode: 1, line: 'm', participants: ['리안', '카엘'] }),
  doc({ id: 'rian', category: 'char', name: '리안', aliases: ['견습 서약사'], body: '끈질기고 확신이 강한 견습생.',
    properties: [{ name: '나이', value: '17' }, { name: '상태', value: '봉인의 속삭임을 들음' }] }),
]

/** 설정 위키 본문을 그린다(분류 상자의 작품 링크 때문에 라우터 안에서). */
const show = (docs: ReadingWorldRecord['documents'], upto = 2) => render(<MemoryRouter><PublicWikiArticle work={served(docs)} upto={upto} /></MemoryRouter>).container

describe('독자용 설정 위키 본문 (U45)', () => {
  it('분류 순서대로 목차·번호 문단을 만들고 이름·별칭·설명·공개된 속성을 정보 상자로 읽기 전용 표시한다', () => {
    const panel = show(documents)
    // 서버가 준 문서 순서와 상관없이 사전 분류 순서(캐릭터·사건·장소·…·세계관 설정)로 묶는다.
    expect([...panel.querySelectorAll('details > summary')].map((s) => s.textContent)).toEqual(['1. 캐릭터', '2. 사건', '3. 장소', '4. 세계관 설정'])
    within(within(panel).getByRole('navigation', { name: '목차' })).getByRole('link', { name: '1.1. 리안' })
    const rian = within(panel).getByRole('heading', { name: '1.1. 리안', level: 3 }).closest('.nw-doc') as HTMLElement
    within(rian).getByText('끈질기고 확신이 강한 견습생.')
    const info = within(rian).getByRole('table', { name: '리안' })
    expect([...info.querySelectorAll('th')].map((e) => e.textContent)).toEqual(['분류', '별칭', '나이', '상태'])
    expect([...info.querySelectorAll('td')].map((e) => e.textContent)).toEqual(['캐릭터', '견습 서약사', '17', '봉인의 속삭임을 들음'])
    // 읽기 전용: 입력·버튼·편집 영역이 없다.
    expect(panel.querySelector('input, textarea, select, button, [contenteditable]')).toBeNull()
  })

  it('사건은 회차·종류·등장 인물을, 연결과 지식은 이름과 공개 회차로 보여 주고 문서 ID는 노출하지 않는다', () => {
    const panel = show(documents)
    const event = within(panel).getByRole('heading', { name: /탑 앞에서 밤을 지새우다/ }).closest('.nw-doc') as HTMLElement
    within(within(event).getByRole('table')).getByText('1화 · 메인')
    // 위키에 문서가 있는 인물(리안)은 링크, 없는 인물(카엘)은 글자로 둔다.
    within(event).getByRole('link', { name: '리안' })
    expect(within(event).queryByRole('link', { name: '카엘' })).toBeNull()
    const tower = within(panel).getByRole('heading', { name: /별빛 탑$/ }).closest('.nw-doc') as HTMLElement
    within(tower).getByRole('link', { name: '봉인 규칙' })
    within(tower).getByText('(소속)', { exact: false })
    const rule = within(panel).getByRole('heading', { name: /봉인 규칙$/ }).closest('.nw-doc') as HTMLElement
    within(rule).getByText('(2화 공개)', { exact: false })
    expect(panel.textContent).not.toContain('tower')
    expect(panel.textContent).not.toContain('rule')
  })

  it('기존 작품 설정 위키(연결된 세계관 없음) 문서의 image 값은 그리지 않는다: 카드 이미지는 연결된 세계관의 카드 이미지뿐이다', () => {
    const panel = show([doc({ id: 'rian', category: 'char', name: '리안', body: '견습생', image: '/legacy-image.png' })])
    expect(panel.querySelector('img')).toBeNull()
  })

  it('공개 범위를 회차로 알려 준다', () => {
    show(documents, 1)
    screen.getByText('1화까지 공개된 설정만 보여요.')
  })

  it('공개된 설정이 없으면 빈 상태를 보여 준다', () => {
    const panel = show([], 1)
    within(panel).getByText('공개된 설정이 없어요.')
    expect(panel.querySelector('details')).toBeNull()
  })
})

describe('연결된 세계관의 설정 카드로 채운 설정 위키 (DEC-46)', () => {
  const card = (id: string, extra: Partial<ReaderWorldCard>): ReaderWorldCard => ({ id, title: id, text: '', cardType: 'character', aliases: [], tags: [], revealFromEpisode: 1, ...extra })
  const cards = [
    card('tower', { title: '별빛 탑', cardType: 'location', text: '봉인을 지키는 **탑**.', revealFromEpisode: 2 }),
    card('rian', { title: '리안', text: '끈질긴 견습생.\n\n## 성격\n확신이 강하다.', aliases: ['견습 서약사'], tags: ['주인공', '서약사'] }),
    card('seal', { title: '봉인 규칙', cardType: 'rule', text: '해가 지면 문이 닫힌다.' }),
  ]
  const relationships: ReaderWorldCards['relationships'] = [
    { id: 'r1', sourceCardId: 'rian', targetCardId: 'tower', label: '머무는 곳' },
    { id: 'r2', sourceCardId: 'seal', targetCardId: 'tower', label: '' },
  ]
  const showLinked = (list = cards, rels = relationships) => render(<MemoryRouter><PublicWikiArticle work={{ ...mapReadingWork(record), wiki: worldCardWiki({ workId: record.id, upto: 2, cards: list, relationships: rels }) }} upto={2} /></MemoryRouter>).container
  const docOf = (panel: HTMLElement, name: RegExp) => within(panel).getByRole('heading', { name, level: 3 }).closest('.nw-doc') as HTMLElement

  it('카드 유형별로 묶어 본문 마크다운·별칭·태그·독자 공개 회차를 읽기 전용으로 보이고 본문의 `##` 문단은 문서 제목 아래 소제목이 된다', () => {
    const panel = showLinked()
    // 서버가 준 카드 순서와 상관없이 카드 유형 순서(인물·장소·…·규칙)로 묶는다.
    expect([...panel.querySelectorAll('details > summary')].map((s) => s.textContent)).toEqual(['1. 인물', '2. 장소', '3. 규칙'])
    const rian = docOf(panel, /^1\.1\. 리안$/)
    const info = within(rian).getByRole('table', { name: '리안' })
    expect([...info.querySelectorAll('th')].map((e) => e.textContent)).toEqual(['분류', '별칭', '태그', '공개'])
    expect([...info.querySelectorAll('td')].map((e) => e.textContent)).toEqual(['인물', '견습 서약사', '주인공, 서약사', '1화부터'])
    within(rian).getByText('끈질긴 견습생.')
    within(rian).getByRole('heading', { name: '성격', level: 4 })
    expect(rian.textContent).not.toContain('##')
    // 마크다운 기호는 글자로 남지 않고 서식이 된다.
    expect(docOf(panel, /별빛 탑$/).querySelector('strong')?.textContent).toBe('탑')
    expect(panel.textContent).not.toContain('**')
    expect(panel.querySelector('input, textarea, select, button, [contenteditable]')).toBeNull()
  })

  it('본문의 설정 링크(DEC-53)는 위키에 있는 카드의 문서로 건너가는 링크이고 위키에 없는 카드(서버가 거른 카드)는 글자만 보인다', () => {
    const [tower, gone] = ['aaaaaaaa-2222-3333-4444-555555555555', 'bbbbbbbb-2222-3333-4444-555555555555']
    const panel = showLinked([
      card(tower, { title: '별빛 탑', cardType: 'location', text: '봉인을 지킨다.' }),
      card('rian', { title: '리안', text: `[별빛 탑](card:${tower})과 [사라진 곳](card:${gone})` }),
    ])
    const rian = docOf(panel, /리안$/)
    expect(within(rian).getByRole('link', { name: '별빛 탑' }).getAttribute('href')).toBe(`#doc-${tower}`)
    expect(within(rian).queryByRole('link', { name: '사라진 곳' })).toBeNull()
    expect(rian.textContent).toContain('별빛 탑과 사라진 곳')
    expect(panel.textContent).not.toContain('card:') // 어느 쪽도 주소가 글자로 남지 않는다
  })

  it('이미지가 있는 카드는 정보 상자 맨 위에 독자 설정 위키 이미지 주소(같은 기준 회차)의 이미지를 보이고 없는 카드에는 없으며 읽지 못하면 감춘다', () => {
    const panel = showLinked(cards.map((c) => (c.id === 'rian' ? { ...c, imageId: 'image 1' } : c)))
    const rian = docOf(panel, /리안$/)
    const image = within(rian).getByRole('img', { name: '리안 이미지' })
    expect(image.getAttribute('src')).toBe('/api/v1/public/works/work-uuid/world-card-images/image%201?upto=2')
    expect(rian.querySelector('.nw-info tbody tr:first-child')?.contains(image)).toBe(true) // 분류 행보다 위
    expect(panel.querySelectorAll('img')).toHaveLength(1) // 이미지 없는 카드(별빛 탑·봉인 규칙)에는 없다
    fireEvent.error(image)
    expect(within(rian).queryByRole('img')).toBeNull()
    within(rian).getByRole('table', { name: '리안' }) // 감춰도 정보 상자는 그대로다
  })

  it('이미지가 없는 카드(imageId가 null이거나 없음)에는 이미지가 없다', () => {
    expect(showLinked(cards.map((c) => ({ ...c, imageId: null }))).querySelector('img')).toBeNull()
  })

  const relationHeads = (doc: HTMLElement) => [...doc.querySelectorAll('.nw-relsec h4')].map((h) => h.textContent)
  const receivedLines = (doc: HTMLElement) => [...doc.querySelectorAll('.nw-rel')].map((p) => p.textContent)
  const directed: ReaderWorldCards['relationships'] = [{ id: 'r1', sourceCardId: 'rian', targetCardId: 'tower', label: '머무는 곳', direction: 'directed' }]

  it('방향이 없는 관계는 양 끝 문서에 상대 — 관계명 소제목 문단으로 보이고 소제목의 상대는 그 문서로 가는 링크이며 라벨이 없으면 이름만 보인다', () => {
    const panel = showLinked()
    expect(relationHeads(docOf(panel, /리안$/))).toEqual(['별빛 탑 — 머무는 곳 방향 미상'])
    expect(relationHeads(docOf(panel, /별빛 탑$/))).toEqual(['리안 — 머무는 곳 방향 미상', '봉인 규칙 방향 미상'])
    expect(relationHeads(docOf(panel, /봉인 규칙$/))).toEqual(['별빛 탑 방향 미상'])
    expect(within(docOf(panel, /봉인 규칙$/)).getByRole('link', { name: '별빛 탑' }).getAttribute('href')).toBe('#doc-tower')
    expect(panel.querySelector('.nw-rel')).toBeNull() // 연결 줄도 받는 쪽 링크 줄도 없다
    expect(within(panel).queryByText(/연결을 불러오지 못했어요/)).toBeNull()
  })

  it('관계 설명은 마크다운으로 소제목 아래에 보이고 본문의 설정 링크는 위키의 그 카드 문서로 건너가며 위키에 없는 카드는 글자만 보인다', () => {
    const [tower, gone] = ['aaaaaaaa-2222-3333-4444-555555555555', 'bbbbbbbb-2222-3333-4444-555555555555']
    const panel = showLinked(
      [card(tower, { title: '별빛 탑', cardType: 'location' }), card('rian', { title: '리안' })],
      [{ id: 'r1', sourceCardId: 'rian', targetCardId: tower, label: '머무는 곳', direction: 'directed', body: `**밤마다** 찾는다. [별빛 탑](card:${tower})과 [사라진 곳](card:${gone})` }],
    )
    const section = docOf(panel, /리안$/).querySelector('.nw-relsec') as HTMLElement
    expect(section.querySelector('strong')?.textContent).toBe('밤마다')
    expect(within(section).getAllByRole('link', { name: '별빛 탑' }).map((a) => a.getAttribute('href'))).toEqual([`#doc-${tower}`, `#doc-${tower}`]) // 소제목의 상대와 본문 링크
    expect(within(section).queryByRole('link', { name: '사라진 곳' })).toBeNull()
    expect(section.textContent).toContain('밤마다 찾는다. 별빛 탑과 사라진 곳')
    expect(panel.textContent).not.toContain('card:')
  })

  it('단방향 관계는 보내는 쪽 문서에만 문단이고 받는 쪽 문서에는 이 설정을 가리키는 관계 줄의 상대(관계명) 링크뿐이며 링크는 보내는 쪽 문단 앵커를 가리킨다', () => {
    const panel = showLinked(cards, directed)
    const [rian, tower] = [docOf(panel, /리안$/), docOf(panel, /별빛 탑$/)]
    expect(relationHeads(rian)).toEqual(['별빛 탑 — 머무는 곳']) // 단방향·확인 표시는 적지 않는다
    expect(rian.querySelector('.nw-rel')).toBeNull()
    expect(rian.querySelector('.nw-relsec')?.id).toBe('rel-rian-r1')
    expect(relationHeads(tower)).toEqual([])
    expect(receivedLines(tower)).toEqual(['이 설정을 가리키는 관계 리안(머무는 곳)'])
    expect(within(tower).getByRole('link', { name: '리안(머무는 곳)' }).getAttribute('href')).toBe('#rel-rian-r1')
  })

  it('양 끝 문서에서 단방향·대칭·부정·본문과 기존 관계의 방향 미상을 구별한다', () => {
    const panel = showLinked(cards, [
      { id: 'a', sourceCardId: 'rian', targetCardId: 'tower', label: '관계', direction: 'directed', polarity: 'denied', body: '근거\n원문' },
      { id: 'b', sourceCardId: 'tower', targetCardId: 'rian', label: '관계', direction: 'symmetric', polarity: 'asserted' },
      { id: 'c', sourceCardId: 'rian', targetCardId: 'tower', label: '관계' },
    ])
    const [rian, tower] = [docOf(panel, /리안$/), docOf(panel, /별빛 탑$/)]
    expect(relationHeads(rian)).toEqual(['별빛 탑 — 관계 부정된 관계', '별빛 탑 — 관계 대칭 관계', '별빛 탑 — 관계 방향 미상'])
    expect(relationHeads(tower)).toEqual(['리안 — 관계 대칭 관계', '리안 — 관계 방향 미상']) // 단방향(a)은 받는 쪽이라 문단이 없다
    expect(receivedLines(tower)).toEqual(['이 설정을 가리키는 관계 리안(관계)'])
    expect(rian.textContent).toContain('근거\n원문')
    expect(tower.textContent).not.toContain('근거')
  })

  it('「동일 인물」은 다른 이름 문서에는 본체 — 동일 인물 문단으로, 본체 문서에는 받는 쪽 링크로 보이고 종류·방향 표시나 옛 정체·다른 이름 표시를 붙이지 않는다', () => {
    const people = [card('mask', { title: '승상' }), card('body', { title: '홍길동' })]
    const panel = showLinked(people, [{ id: 'i', sourceCardId: 'mask', targetCardId: 'body', label: '승상 · 동일 인물 · 홍길동', category: 'identity', direction: 'directed', polarity: 'asserted', body: '' }])
    const [mask, body] = [docOf(panel, /승상$/), docOf(panel, /홍길동$/)]
    expect(relationHeads(mask)).toEqual(['홍길동 — 동일 인물'])
    expect(mask.querySelector('.nw-relsec p')).toBeNull() // 설명이 없으면 문단 본문도 없다
    expect(relationHeads(body)).toEqual([])
    expect(receivedLines(body)).toEqual(['이 설정을 가리키는 관계 승상(동일 인물)'])
    expect(panel.textContent).not.toMatch(/구조 관계|단방향|확인된 관계|정체|다른 이름/)
  })

  it('받는 쪽 링크를 누르면 보내는 쪽 문서의 그 관계 문단으로 이동해 초점을 옮기고 짧게 강조하며 접힌 분류도 펼치고 움직임 줄이기면 고정 강조한다', () => {
    const panel = showLinked(cards, directed)
    const target = panel.querySelector<HTMLElement>('#rel-rian-r1')!
    const group = target.closest('details') as HTMLDetailsElement
    group.open = false
    const link = within(docOf(panel, /별빛 탑$/)).getByRole('link', { name: '리안(머무는 곳)' })
    expect(fireEvent.click(link)).toBe(false) // 기본 이동을 막는다
    expect(group.open).toBe(true)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' })
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(target)
    expect(document.activeElement).toBe(target)
    expect(animate.mock.contexts).toEqual([target])
    expect((animate.mock.calls[0][0] as { backgroundColor: string }[]).at(-1)?.backgroundColor).toBe('transparent') // 서서히 사라진다
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    fireEvent.click(link)
    const frames = animate.mock.calls.at(-1)![0] as { backgroundColor: string }[]
    expect(frames[0].backgroundColor).toBe(frames[1].backgroundColor)
  })
})
