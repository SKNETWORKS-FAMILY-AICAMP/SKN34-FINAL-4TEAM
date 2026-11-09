// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ReadingWorkRecord, ReadingWorldRecord } from '../../../../data/content/HttpEpisodeRepository'
import { mapReadingWork, withReadingWorld } from '../../../../data/content/readingWork'
import { PublicWikiPanel } from './PublicWiki'

afterEach(cleanup)

const record: ReadingWorkRecord = {
  id: 'work-uuid', slug: null, title: '별빛 서약의 탑', summary: '소개', visibility: 'public', authorName: '윤서하', ownerId: 'owner-uuid',
  revision: 2, theme: 'star', hook: '', hanja: null, hero: null, heroBg: null, genres: ['판타지'], hashtags: [], views: 0,
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

describe('독자용 공개 설정 패널', () => {
  it('분류 순서대로 묶어 이름·별칭·설명·공개된 속성을 읽기 전용으로 보여 준다', () => {
    render(<PublicWikiPanel work={served(documents)} upto={2} />)
    const panel = screen.getByRole('region', { name: '공개된 설정' })
    // 서버가 준 문서 순서와 상관없이 사전 분류 순서(캐릭터·사건·장소·…·세계관 설정)로 묶고 개수를 함께 보여 준다.
    expect([...panel.querySelectorAll('details > summary')].map((s) => s.textContent)).toEqual(['캐릭터1', '사건1', '장소1', '세계관 설정1'])
    const rian = within(panel).getByRole('heading', { name: '리안', level: 4 }).closest('article')!
    within(rian).getByText('별칭 · 견습 서약사')
    within(rian).getByText('끈질기고 확신이 강한 견습생.')
    expect([...rian.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['나이', '상태'])
    expect([...rian.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['17', '봉인의 속삭임을 들음'])
    // 읽기 전용: 입력·버튼·편집 영역이 없다.
    expect(panel.querySelector('input, textarea, select, button, [contenteditable]')).toBeNull()
  })

  it('사건은 회차·종류·등장 인물을, 연결과 지식은 이름과 공개 회차로 보여 주고 문서 ID는 노출하지 않는다', () => {
    render(<PublicWikiPanel work={served(documents)} upto={2} />)
    const panel = screen.getByRole('region', { name: '공개된 설정' })
    const event = within(panel).getByRole('heading', { name: /탑 앞에서 밤을 지새우다/ }).closest('article')!
    within(event).getByText('1화 · 메인')
    within(event).getByText('등장 · 리안, 카엘')
    const tower = within(panel).getByRole('heading', { name: '별빛 탑' }).closest('article')!
    within(tower).getByText('연결 · 봉인 규칙(소속)')
    const rule = within(panel).getByRole('heading', { name: '봉인 규칙' }).closest('article')!
    within(rule).getByText('봉인은 새벽에 약해진다 · 2화 공개')
    expect(panel.textContent).not.toContain('tower')
    expect(panel.textContent).not.toContain('rule')
  })

  it('공개 범위를 회차로 알려 준다', () => {
    render(<PublicWikiPanel work={served(documents)} upto={2} />)
    screen.getByText('2화까지 공개된 설정만 보여요.')
  })

  it('공개된 설정이 없으면 빈 상태를 보여 준다', () => {
    render(<PublicWikiPanel work={served([])} upto={1} />)
    const panel = screen.getByRole('region', { name: '공개된 설정' })
    within(panel).getByText('공개된 설정이 없어요.')
    expect(panel.querySelector('details')).toBeNull()
  })
})
