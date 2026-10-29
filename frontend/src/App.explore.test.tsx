// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderApp } from './test/renderApp'

afterEach(cleanup)

const sid = () => document.getElementById('sid')!.textContent
const titles = () => [...document.querySelectorAll('.rgrid .ri b')].map((b) => b.textContent)

describe('검색 결과 (U36)', () => {
  it('제목·작가·태그 범위로 찾고 결과 수를 보여 준다', async () => {
    renderApp('/search?q=구운몽')
    await screen.findByRole('heading', { name: '‘구운몽’ 검색 결과' })
    await waitFor(() => expect(sid()).toBe('U36 검색 결과'))
    await screen.findByText('4편')
    cleanup()
    renderApp('/search?q=윤서하&f=author')
    await screen.findByText('1편')
    expect(titles()).toEqual(['회색 도시의 우편배달부'])
    cleanup()
    // 포크 소설은 원작의 해시태그를 이어받습니다.
    renderApp('/search?q=%23꿈&f=tag')
    await screen.findByText('4편')
    expect(titles()).toContain('구운몽: 저승의 문')
  })

  it('장르만 맞는 검색어는 목업 matchW처럼 결과 없음 안내를 보여 준다', async () => {
    renderApp('/search?q=판타지')
    await screen.findByText('검색 결과가 없어요. 다른 검색어나 범위로 찾아 보세요.')
    screen.getByText('0편')
  })

  it('정렬을 바꾸고 검색어를 제출하면 결과가 바뀐다', async () => {
    renderApp('/search')
    await screen.findByRole('heading', { name: '소설 검색' })
    await waitFor(() => expect(titles()[0]).toBe('구운몽'))
    fireEvent.click(screen.getByRole('button', { name: '최신 순' }))
    await waitFor(() => expect(titles()[0]).toBe('구운몽: 저승의 문'))
    expect(screen.getByRole('button', { name: '최신 순' }).className).toBe('on')
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '회색' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await screen.findByRole('heading', { name: '‘회색’ 검색 결과' })
    await waitFor(() => expect(titles()).toEqual(['회색 도시: 송신탑 아래', '회색 도시: 답장', '회색 도시의 우편배달부']))
  })

  it('검색 카드에서 소설 신고 시트를 연다 (랭킹 카드에는 없다)', async () => {
    renderApp('/search?q=홍길동')
    fireEvent.click(await screen.findByRole('button', { name: '홍길동전 소설 신고' }))
    screen.getByRole('heading', { name: '🚩 소설 신고 · 홍길동전' })
    cleanup()
    renderApp('/rank')
    await screen.findByRole('heading', { name: '랭킹' })
    await waitFor(() => expect(titles().length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /소설 신고/ })).toBeNull()
  })
})

describe('랭킹 (U25)·포크 소설 (U26)', () => {
  it('GNB 랭킹에서 열고 원작·포크 탭을 바꾼다', async () => {
    renderApp('/')
    fireEvent.click(within(screen.getByRole('navigation', { name: '주요 메뉴' })).getByRole('button', { name: /랭킹/ }))
    await screen.findByRole('heading', { name: '랭킹' })
    await waitFor(() => expect(sid()).toBe('U25 랭킹'))
    screen.getByText('조회 순 · 데모 데이터')
    await waitFor(() => expect(titles()).toHaveLength(11))
    expect(document.querySelector('.crown')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '원작 소설' }))
    await waitFor(() => expect(titles()).toEqual(['구운몽', '회색 도시의 우편배달부', '홍길동전', '별빛 서약의 탑']))
    fireEvent.click(screen.getByRole('button', { name: '포크 소설' }))
    await waitFor(() => expect(titles()).toHaveLength(7))
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '없는소설' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await screen.findByText('조건에 맞는 소설이 없어요.')
  })

  it('/ifs에 원작이 없으면 랭킹 포크 탭으로 보낸다', async () => {
    renderApp('/ifs')
    await screen.findByRole('heading', { name: '랭킹' })
    await waitFor(() => expect(titles()).toHaveLength(7))
    expect(screen.getByRole('button', { name: '포크 소설' }).className).toBe('on')
  })

  it('/ifs?w=에서 한 원작의 포크를 정렬해 보여 준다', async () => {
    renderApp('/ifs?w=guunmong')
    await screen.findByRole('heading', { name: '포크 소설' })
    await waitFor(() => expect(sid()).toBe('U26 포크 소설 모아보기'))
    const forks = () => [...document.querySelectorAll('.ifc b')].map((b) => b.textContent)
    await waitFor(() => expect(forks()).toEqual(['구름 위의 길', '저승의 문', '스승의 용서']))
    screen.getByText('2·3·4화 포크 허용')
    screen.getByRole('button', { name: '✎ 나도 포크하기' })
    fireEvent.click(screen.getByRole('button', { name: '최신 순' }))
    await waitFor(() => expect(forks()).toEqual(['저승의 문', '구름 위의 길', '스승의 용서']))
  })

  it('포크를 허용하지 않은 원작은 안내 문구를 보여 준다', async () => {
    renderApp('/ifs?w=hong')
    await screen.findByText('소설 소유자가 포크를 허용하지 않았어요.')
    expect(screen.queryByRole('button', { name: '✎ 나도 포크하기' })).toBeNull()
  })
})

describe('해시태그 모아보기 (U29)', () => {
  it('태그별 소설과 태그 막대를 보여 주고 다른 태그로 이동한다', async () => {
    renderApp('/tag/꿈')
    await screen.findByRole('heading', { name: '#꿈' })
    await waitFor(() => expect(sid()).toBe('U29 해시태그 모아보기'))
    screen.getByText('이 해시태그가 붙은 소설 4편 · 포크 소설은 원작의 해시태그를 이어받아요')
    expect(titles()[0]).toBe('구운몽')
    fireEvent.click(screen.getByRole('button', { name: '#활빈당1' }))
    await screen.findByRole('heading', { name: '#활빈당' })
    expect(titles()).toEqual(['홍길동전'])
  })
})
