// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../app/appContainer'
import { renderApp } from '../renderApp'

afterEach(cleanup)

const sid = () => document.getElementById('sid')!.textContent
const titles = () => [...document.querySelectorAll('.rgrid .ri b')].map((b) => b.textContent)
/** 검색 카드의 소설 신고는 카드 안 더보기 메뉴(#507)로 연다. */
const openReport = async (title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `${title} 더보기` }))
  fireEvent.click(screen.getByRole('menuitem', { name: `${title} 소설 신고` }))
}

describe('검색 결과 (U36)', () => {
  it('제목·작가·태그·장르 범위로 찾고 결과 수를 보여 준다', async () => {
    renderApp('/search?q=구운몽')
    await screen.findByRole('heading', { name: '‘구운몽’ 검색 결과' })
    await waitFor(() => expect(sid()).toBe('U36 검색 결과'))
    await screen.findByText('4편')
    cleanup()
    renderApp('/search?q=윤서하&f=author')
    await screen.findByText('1편')
    expect(titles()).toEqual(['회색 도시의 우편배달부'])
    cleanup()
    renderApp('/search?q=SF&f=genre')
    await screen.findByText('3편')
    expect(titles()).toEqual(['회색 도시: 송신탑 아래', '회색 도시: 답장', '회색 도시의 우편배달부'])
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
    // 기본 정렬은 서버 계약의 최신 순(latest)이다.
    await waitFor(() => expect(titles()[0]).toBe('구운몽: 저승의 문'))
    expect(screen.getByRole('link', { name: '최신 순' }).className).toBe('on')
    fireEvent.click(screen.getByRole('link', { name: '조회 순' }))
    await waitFor(() => expect(titles()[0]).toBe('구운몽'))
    expect(screen.getByRole('link', { name: '조회 순' }).className).toBe('on')
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '회색' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await screen.findByRole('heading', { name: '‘회색’ 검색 결과' })
    await waitFor(() => expect(titles()).toEqual(['회색 도시의 우편배달부', '회색 도시: 송신탑 아래', '회색 도시: 답장']))
  })

  it('검색 범위·정렬은 서버가 지원하는 값만 고르게 한다 (인기 순은 좋아요 순 like)', async () => {
    renderApp('/search')
    const scope = await screen.findByRole('group', { name: '검색 범위' })
    const sort = screen.getByRole('group', { name: '정렬' })
    expect([...scope.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['전체', '제목', '작가', '태그', '장르'])
    expect([...sort.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['최신 순', '인기 순', '조회 순'])
    fireEvent.click(within(sort).getByRole('link', { name: '인기 순' }))
    await waitFor(() => expect(screen.getByRole('link', { name: '인기 순' }).className).toBe('on'))
    await waitFor(() => expect(titles()[0]).toBe('구운몽'))
  })

  it('검색 카드의 더보기 메뉴에서 소설 신고 시트를 연다 (랭킹 카드에는 메뉴가 없다)', async () => {
    renderApp('/search?q=홍길동')
    await openReport('홍길동전')
    screen.getByRole('heading', { name: '🚩 소설 신고 · 홍길동전' })
    cleanup()
    renderApp('/rank')
    await screen.findByRole('heading', { name: '랭킹' })
    await waitFor(() => expect(titles().length).toBeGreaterThan(0))
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /더보기/ })).toBeNull()
  })

  it('내 소설 카드에는 신고 메뉴가 없고 남의 소설 카드에는 있다 (#196)', async () => {
    renderApp('/search?q=별빛')
    await screen.findByRole('button', { name: '별빛 서약의 탑: 재의 왕관 더보기' })
    expect(titles()).toContain('별빛 서약의 탑')
    expect(screen.queryByRole('button', { name: '별빛 서약의 탑 더보기' })).toBeNull()
  })

  it('서버(정본) 작품도 남의 공개 작품이면 신고 버튼이 보이고 운영 신고 폼으로 접수한다 (#196)', async () => {
    const works = appContainer.resolve('mockDb').works
    const submit = vi.spyOn(appContainer.resolve('reportUseCase'), 'submit').mockResolvedValue(undefined)
    for (const work of works) work.canonical = true
    try {
      renderApp('/search?q=홍길동')
      await openReport('홍길동전')
      const dialog = screen.getByRole('dialog', { name: '소설 신고' })
      fireEvent.change(within(dialog).getByLabelText('신고 사유'), { target: { value: '권리 확인 부탁' } })
      fireEvent.click(within(dialog).getByRole('button', { name: '신고 접수' }))
      await within(dialog).findByText(/신고를 접수했어요/)
      expect(submit).toHaveBeenCalledWith({ kind: 'RIGHTS', workId: 'hong', reason: '권리 확인 부탁', evidence: '' })
    } finally {
      cleanup()
      submit.mockRestore()
      for (const work of works) delete work.canonical
    }
  })
})

describe('랭킹 (U25)·포크 소설 (U26)', () => {
  it('GNB 랭킹에서 열고 원작·포크 탭을 바꾼다', async () => {
    renderApp('/')
    fireEvent.click(within(screen.getByRole('navigation', { name: '주요 메뉴' })).getByRole('link', { name: /랭킹/ }))
    await screen.findByRole('heading', { name: '랭킹' })
    await waitFor(() => expect(sid()).toBe('U25 랭킹'))
    screen.getByText('조회 순 · 최근 24시간 · 14:07 기준')
    await waitFor(() => expect(titles()).toHaveLength(11))
    expect(document.querySelector('.crown')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '원작 소설' }))
    await waitFor(() => expect(titles()).toEqual(['구운몽', '회색 도시의 우편배달부', '홍길동전', '별빛 서약의 탑']))
    fireEvent.click(screen.getByRole('link', { name: '포크 소설' }))
    await waitFor(() => expect(titles()).toHaveLength(7))
    // 검색 입력은 /search가 맡으므로 랭킹에서는 기준·기간 링크로 순위를 바꾼다.
    expect(screen.queryByLabelText('검색어')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '인기 순' }))
    await screen.findByText('인기 순 · 최근 24시간 · 14:07 기준')
    await waitFor(() => expect(titles()[0]).toBe('구운몽: 구름 위의 길'))
    fireEvent.click(screen.getByRole('link', { name: '최신 순' }))
    await screen.findByText('최신 순 · 14:07 기준')
    expect(screen.queryByRole('group', { name: '집계 기간' })).toBeNull()
  })

  it('/ifs에 원작이 없으면 랭킹 포크 탭으로 보낸다', async () => {
    renderApp('/ifs')
    await screen.findByRole('heading', { name: '랭킹' })
    await waitFor(() => expect(titles()).toHaveLength(7))
    expect(screen.getByRole('link', { name: '포크 소설' }).className).toBe('on')
  })

  it('/ifs?w=에서 한 원작의 포크를 정렬해 보여 준다', async () => {
    renderApp('/ifs?w=guunmong')
    await screen.findByRole('heading', { name: '포크 소설' })
    await waitFor(() => expect(sid()).toBe('U26 포크 소설 모아보기'))
    const forks = () => [...document.querySelectorAll('.ifc b')].map((b) => b.textContent)
    await waitFor(() => expect(forks()).toEqual(['구름 위의 길', '저승의 문', '스승의 용서']))
    screen.getByText('2·3·4화 포크 허용')
    screen.getByRole('link', { name: '✎ 나도 포크하기' })
    // 통계가 있는 목업 작품은 최신·인기·조회 순을 고른다(서버 작품의 제목·작가 순은 sortOptions 단위 테스트).
    fireEvent.click(screen.getByRole('link', { name: '최신 순' }))
    await waitFor(() => expect(forks()).toEqual(['저승의 문', '구름 위의 길', '스승의 용서']))
  })

  it('포크를 허용하지 않은 원작은 안내 문구를 보여 준다', async () => {
    renderApp('/ifs?w=hong')
    await screen.findByText('소설 소유자가 포크를 허용하지 않았어요.')
    expect(screen.queryByRole('link', { name: '✎ 나도 포크하기' })).toBeNull()
  })
})

describe('해시태그 모아보기 (U29)', () => {
  it('태그별 소설과 태그 막대를 보여 주고 다른 태그로 이동한다', async () => {
    renderApp('/tag/꿈')
    await screen.findByRole('heading', { name: '#꿈' })
    await waitFor(() => expect(sid()).toBe('U29 해시태그 모아보기'))
    screen.getByText('이 해시태그가 붙은 소설 4편 · 포크 소설은 원작의 해시태그를 이어받아요')
    expect(titles()[0]).toBe('구운몽')
    fireEvent.click(screen.getByRole('link', { name: '#활빈당1' }))
    await screen.findByRole('heading', { name: '#활빈당' })
    expect(titles()).toEqual(['홍길동전'])
  })
})

describe('세계관·설정 카드 검색 (#505)', () => {
  // 한 파일의 fixture 컨테이너는 테스트 사이에 공유되므로 spyOn은 매번 되돌린다(renderApp이 작품 검색 스텁을 다시 건다).
  afterEach(() => { vi.restoreAllMocks() })
  const publicWorlds = () => appContainer.resolve('publicWorldRepository')
  const workSearch = () => vi.mocked(appContainer.resolve('workSearchRepository').search)
  const worldNames = () => [...document.querySelectorAll('.grid6 .hk')].map((h) => h.textContent)
  const cardRows = () => [...document.querySelectorAll('.worlds-board-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
  // 앱 전체 렌더에는 브라우저 인증 안내 같은 전역 alert가 따로 있어 결과 영역(main) 안에서만 찾는다.
  const main = () => within(screen.getByRole('main'))
  const tabLinks = async () => [...(await screen.findByRole('navigation', { name: '검색 대상' })).querySelectorAll('a')]
  const cardHit = (n: number) => ({ worldId: 'w', worldName: '세계', cardId: `c${n}`, title: `카드 ${String(n).padStart(2, '0')}`, cardType: 'other' as const, aliases: [], tags: [], imageId: null })

  it('탭은 작품(기본)·세계관·설정 카드·캐릭터챗이고 주소 type이 선택을 정하며 검색어는 탭 링크에 이어진다', async () => {
    renderApp('/search?q=달무리')
    const q = encodeURIComponent('달무리')
    const links = await tabLinks()
    expect(links.map((a) => a.textContent)).toEqual(['작품', '세계관', '설정 카드', '캐릭터챗'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([`/search?q=${q}`, `/search?q=${q}&type=world`, `/search?q=${q}&type=card`, `/search?q=${q}&type=chat`])
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['true', null, null, null])
    cleanup()
    renderApp('/search?type=card')
    expect((await tabLinks()).map((a) => [a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([['/search', null], ['/search?type=world', null], ['/search?type=card', 'true'], ['/search?type=chat', null]])
    cleanup()
    renderApp('/search?type=zzz') // 모르는 값은 작품이다
    expect((await tabLinks()).map((a) => a.getAttribute('aria-current'))).toEqual(['true', null, null, null])
  })

  it('범위·정렬 도구는 작품 탭에만 있고 세계관·설정 카드 탭은 검색어 입력만 둔다', async () => {
    renderApp('/search?type=world')
    expect((await screen.findByLabelText('검색어')).getAttribute('placeholder')).toBe('세계관 이름·설명·작가로 찾기')
    expect(screen.queryByRole('group', { name: '검색 범위' })).toBeNull()
    expect(screen.queryByRole('group', { name: '정렬' })).toBeNull()
    cleanup()
    renderApp('/search?type=card')
    expect((await screen.findByLabelText('검색어')).getAttribute('placeholder')).toBe('설정 카드 제목·별칭·태그로 찾기')
    expect(screen.queryByRole('group', { name: '검색 범위' })).toBeNull()
    cleanup()
    renderApp('/search')
    await screen.findByRole('group', { name: '검색 범위' })
    screen.getByRole('group', { name: '정렬' })
  })

  it('세계관 탭은 검색어에 맞는 공개 세계관을 /worlds/:id 카드로 보이고 작품 검색은 부르지 않는다', async () => {
    renderApp('/search?type=world&q=항해')
    await screen.findByRole('heading', { name: '‘항해’ 검색 결과' })
    const card = (await screen.findByRole('heading', { level: 3, name: '달무리 군도' })).closest('a')!
    expect(card.getAttribute('href')).toBe('/worlds/moonhalo-isles')
    expect(worldNames()).toEqual(['달무리 군도'])
    screen.getByText('1개')
    expect(workSearch()).not.toHaveBeenCalled()
  })

  it('검색어 없이 세계관 탭을 열면 공개 세계관 전체를 24개씩 보이고 더 보기로 나머지를 이어 붙인다', async () => {
    renderApp('/search?type=world')
    await screen.findByText('26개')
    await waitFor(() => expect(worldNames()).toHaveLength(24))
    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(worldNames()).toHaveLength(26))
    expect(new Set(worldNames()).size).toBe(26)
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  })

  it('맞는 세계관이 없으면 0개와 결과 없음 안내를 보인다', async () => {
    renderApp('/search?type=world&q=없는세계관')
    await screen.findByText('검색 결과가 없어요. 다른 검색어로 찾아 보세요.')
    screen.getByText('0개')
  })

  it('세계관 조회가 실패하면 빈 결과가 아니라 오류 안내를 보이고 다시 불러오면 결과를 보인다', async () => {
    const list = vi.spyOn(publicWorlds(), 'list').mockRejectedValue(new Error('offline'))
    renderApp('/search?type=world&q=항해')
    expect((await main().findByRole('alert')).textContent).toBe('세계관을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(screen.queryByText('0개')).toBeNull()
    expect(screen.queryByText('검색 결과가 없어요. 다른 검색어로 찾아 보세요.')).toBeNull()
    list.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByRole('heading', { level: 3, name: '달무리 군도' })
    expect(main().queryByRole('alert')).toBeNull()
  })

  it('검색어를 바꾸면 진행 중인 더 보기 요청을 취소하고 늦게 온 응답은 새 목록에 붙이지 않는다', async () => {
    const repo = publicWorlds()
    const original = repo.list.bind(repo)
    const held: AbortSignal[] = []
    let release: () => void = () => {}
    const late = new Promise<void>((done) => { release = done })
    vi.spyOn(repo, 'list').mockImplementation(async (query, signal) => {
      if (query.page === 1) { held.push(signal!); await late } // 다음 쪽 요청만 붙잡아 둔다
      return original(query, signal)
    })
    renderApp('/search?type=world')
    fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(held).toHaveLength(1))
    expect(held[0].aborted).toBe(false)
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '항해' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(worldNames()).toEqual(['달무리 군도']))
    expect(held[0].aborted).toBe(true)
    await act(async () => { release(); await late })
    expect(worldNames()).toEqual(['달무리 군도'])
  })

  it('설정 카드 탭은 제목에 맞는 공개 카드를 세계관 최근 공개 순 표로 보이고 카드·세계관 링크를 단다', async () => {
    renderApp('/search?type=card&q=하엘')
    await screen.findByRole('heading', { name: '‘하엘’ 검색 결과' })
    await screen.findByRole('link', { name: '조석신 하엘' })
    expect(cardRows()).toEqual([['인물', '항법사 하엘라', '별물결 정거장', ''], ['인물', '조석신 하엘', '달무리 군도', '']])
    expect(screen.getByRole('link', { name: '조석신 하엘' }).getAttribute('href')).toBe('/worlds/moonhalo-isles/cards/1')
    expect(screen.getByRole('link', { name: '달무리 군도' }).getAttribute('href')).toBe('/worlds/moonhalo-isles')
    screen.getByText('2개')
    expect(workSearch()).not.toHaveBeenCalled()
  })

  it('설정 카드 탭은 검색어가 없으면 요청 없이 안내하고 검색어를 넣으면 찾는다', async () => {
    const searchCards = vi.spyOn(publicWorlds(), 'searchCards')
    renderApp('/search?type=card')
    await screen.findByText('검색어를 입력하면 공개 세계관의 설정 카드를 찾아요.')
    expect(searchCards).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '서진' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(cardRows().map((row) => row[1])).toEqual(['통신사 서진', '검객 서진', '당직의 서진']))
    expect(searchCards).toHaveBeenCalledWith({ q: '서진', page: 0, size: 24 }, expect.any(AbortSignal))
    expect(screen.queryByText('검색어를 입력하면 공개 세계관의 설정 카드를 찾아요.')).toBeNull()
  })

  it('대표 이미지가 있는 카드는 제목 앞에 공개 이미지 썸네일을 붙이고 읽지 못하면 감추며 별칭·태그를 보인다', async () => {
    const hit = { worldId: 'moonhalo-isles', worldName: '달무리 군도', cardId: '1', title: '조석신 하엘', cardType: 'character' as const, aliases: ['하엘님'], tags: ['신'], imageId: 'img-1' }
    vi.spyOn(publicWorlds(), 'searchCards').mockResolvedValue({ items: [hit, { ...hit, cardId: '4', title: '새벽항', cardType: 'location', aliases: [], tags: [], imageId: null }], page: 0, size: 24, total: 2 })
    renderApp('/search?type=card&q=하엘')
    const image = await screen.findByRole('img', { name: '조석신 하엘 이미지' })
    expect(image.getAttribute('src')).toBe('/api/v1/public/world-studios/moonhalo-isles/card-images/img-1')
    expect(screen.queryByRole('img', { name: '새벽항 이미지' })).toBeNull()
    expect(cardRows().map((row) => row[3])).toEqual(['하엘님 · #신', ''])
    fireEvent.error(image)
    expect(screen.queryByRole('img', { name: '조석신 하엘 이미지' })).toBeNull()
  })

  it('설정 카드 탭도 받은 수가 total보다 적으면 더 보기로 다음 쪽을 이어 붙이고 total에 닿으면 버튼이 사라진다', async () => {
    const searchCards = vi.spyOn(publicWorlds(), 'searchCards').mockImplementation(async ({ page, size }) => ({ items: Array.from({ length: page === 0 ? size : 6 }, (_, i) => cardHit(page * size + i)), page, size, total: size + 6 }))
    renderApp('/search?type=card&q=카드')
    await screen.findByText('30개')
    await waitFor(() => expect(cardRows()).toHaveLength(24))
    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(cardRows()).toHaveLength(30))
    expect(searchCards).toHaveBeenLastCalledWith({ q: '카드', page: 1, size: 24 }, expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  })

  it('설정 카드 더 보기가 실패하면 보인 카드는 그대로 두고 버튼 곁에 실패를 알리며 다시 시도로 이어 받는다', async () => {
    let offline = true
    vi.spyOn(publicWorlds(), 'searchCards').mockImplementation(async ({ page, size }) => {
      if (page === 1 && offline) throw new Error('offline')
      return { items: Array.from({ length: page === 0 ? size : 2 }, (_, i) => cardHit(page * size + i)), page, size, total: size + 2 }
    })
    renderApp('/search?type=card&q=카드')
    fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
    expect((await main().findByRole('alert')).textContent).toBe('설정 카드를 더 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(cardRows()).toHaveLength(24)
    offline = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(cardRows()).toHaveLength(26))
    expect(main().queryByRole('alert')).toBeNull()
  })

  it('캐릭터챗 탭은 검색하지 않고 머리말은 검색어가 있어도 캐릭터챗이며 안내와 /chat 목록 링크만 보인다', async () => {
    const list = vi.spyOn(publicWorlds(), 'list')
    const searchCards = vi.spyOn(publicWorlds(), 'searchCards')
    renderApp('/search?type=chat&q=하린')
    await screen.findByText('목록은 누구나 볼 수 있고 대화는 로그인 후 할 수 있어요 · AI 응답은 데모')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('캐릭터챗')
    expect(screen.getByRole('link', { name: '캐릭터챗 목록 보기' }).getAttribute('href')).toBe('/chat')
    expect(screen.queryByLabelText('검색어')).toBeNull()
    expect([workSearch().mock.calls.length, list.mock.calls.length, searchCards.mock.calls.length]).toEqual([0, 0, 0])
  })

  it('탭을 옮겨도 검색어가 입력칸에 남고 검색을 제출해도 고른 탭이 유지된다', async () => {
    renderApp('/search?q=항해')
    const tabs = within(await screen.findByRole('navigation', { name: '검색 대상' }))
    fireEvent.click(tabs.getByRole('link', { name: '세계관' }))
    await screen.findByRole('heading', { level: 3, name: '달무리 군도' })
    expect((screen.getByLabelText('검색어') as HTMLInputElement).value).toBe('항해')
    expect(tabs.getByRole('link', { name: '세계관' }).getAttribute('aria-current')).toBe('true')
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '야시' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(worldNames()).toEqual(['야시의 연인', '인경 뒤의 도깨비 장터']))
    expect(tabs.getByRole('link', { name: '세계관' }).getAttribute('aria-current')).toBe('true')
  })
})

describe('검색 화면 리뷰 반영 (#505·#507)', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const q = encodeURIComponent('달무리')
  const tabs = async () => within(await screen.findByRole('navigation', { name: '검색 대상' }))
  const cardOf = (title: string) => [...document.querySelectorAll('.rgrid .ri b')].find((b) => b.textContent === title)!.closest('.rg-item')!

  it('작품 탭의 범위·정렬은 다른 탭을 거쳐 작품 탭으로 돌아와도 유지된다', async () => {
    renderApp(`/search?q=${q}&f=author&sort=like`)
    const nav = await tabs()
    expect(nav.getByRole('link', { name: '세계관' }).getAttribute('href')).toBe(`/search?q=${q}&f=author&sort=like&type=world`)
    fireEvent.click(nav.getByRole('link', { name: '세계관' }))
    await screen.findByRole('heading', { level: 3, name: '달무리 군도' })
    // 다른 탭에서 검색해도 범위·정렬은 주소에 남아, 작품 탭 링크가 그대로 싣는다.
    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '야시' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(nav.getByRole('link', { name: '작품' }).getAttribute('href')).toBe(`/search?q=${encodeURIComponent('야시')}&f=author&sort=like`))
    fireEvent.click(nav.getByRole('link', { name: '작품' }))
    const scope = await screen.findByRole('group', { name: '검색 범위' })
    expect(within(scope).getByRole('link', { name: '작가' }).getAttribute('aria-current')).toBe('true')
    expect(within(screen.getByRole('group', { name: '정렬' })).getByRole('link', { name: '인기 순' }).getAttribute('aria-current')).toBe('true')
  })

  it('신고 메뉴는 카드 안에 떠 있는 더보기 버튼 하나이고 카드 밖에 따로 붙는 신고 버튼은 없다 (#507)', async () => {
    renderApp('/search?q=별빛')
    const trigger = await screen.findByRole('button', { name: '별빛 서약의 탑: 재의 왕관 더보기' })
    const card = trigger.closest('.rg-item')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect([...card.children].map((el) => (el.matches('a.rg') ? 'card' : el.matches('.pop-menu.rg-more') ? 'menu' : el.tagName))).toEqual(['card', 'menu'])
    // 신고할 수 없는 내 소설 카드는 메뉴 없이 카드만이라 같은 모양이다.
    expect([...cardOf('별빛 서약의 탑').children].map((el) => el.tagName)).toEqual(['A'])
    expect(document.querySelector('.rg-report')).toBeNull()
  })

  it('Esc로 신고 시트를 닫으면 초점이 그 카드의 더보기 버튼으로 돌아온다', async () => {
    renderApp('/search?q=홍길동')
    const trigger = await screen.findByRole('button', { name: '홍길동전 더보기' })
    await openReport('홍길동전')
    screen.getByRole('dialog', { name: '소설 신고' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '소설 신고' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('검색을 제출해도 입력칸을 다시 그리지 않아 키보드 초점이 남고 입력칸에는 제출한 검색어가 있다', async () => {
    renderApp('/search?q=구운몽')
    const input = (await screen.findByLabelText('검색어')) as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '회색' } })
    fireEvent.submit(input.form!) // 입력칸에서 Enter와 같다
    await screen.findByRole('heading', { name: '‘회색’ 검색 결과' })
    expect(screen.getByLabelText('검색어')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('회색')
  })
})
