// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import type { ReadingWorkRecord, ReadingWorldRecord } from '../../../../data/content/HttpEpisodeRepository'
import { mapReadingWork, withReadingWorld } from '../../../../data/content/readingWork'
import { PublicWikiArticle } from './PublicWiki'

afterEach(cleanup)

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
