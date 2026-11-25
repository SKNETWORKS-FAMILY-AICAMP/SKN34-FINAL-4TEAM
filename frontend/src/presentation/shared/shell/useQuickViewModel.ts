import { useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../app/appContainer'
import { useAppSelector } from '../../../app/store'
import type { Work } from '../../../domain/entities/work'
import type { PublicWorldUseCase } from '../../../domain/usecases/PublicWorldUseCase'
import type { ReadingUseCase } from '../../../domain/usecases/ReadingUseCase'
import { useAsyncData } from '../useAsyncData'
import { requestLeave } from '../events'
import { kindOf } from '../worldBoard'

/** 이동 후보 한 줄. `w`(표지)는 작품 후보에만 있다. */
type QuickItem = { k: string; w?: Work; label: string; sub: string; go: string }

/** 세계관·설정 카드 후보: 묶음마다 이만큼만 보이고, 입력이 이만큼(ms) 멈춘 뒤에 찾는다. */
const WORLD_HITS = 3
const TYPING_PAUSE = 250
/** ms 뒤에 끝나는 대기. signal이 취소되면(이미 취소됐어도) 기다리지 않고 거절한다: useAsyncData는 조회를 한 틱 늦게 시작해, 그 사이 입력이 또 바뀌면 이미 취소된 signal로 불린다. */
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((done, fail) => {
  if (signal.aborted) return fail(signal.reason)
  const timer = setTimeout(done, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); fail(signal.reason) }, { once: true })
})

/**
 * 목업 quick(): Ctrl/Cmd+K 또는 GNB 검색 버튼(sf-quick 이벤트)으로 엽니다. 검색어가 있으면 작품 후보(`ReadingUseCase`) 뒤에
 * 공개 세계관·설정 카드 후보(`PublicWorldUseCase`, 묶음마다 3개)를 `세계관`·`설정 카드` 배지로 붙입니다. 목록 앞쪽은 그대로여서 ↑↓로 고른 항목은 뒤늦게 붙는 결과에 밀리지 않습니다.
 */
export function useQuickViewModel(readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase'), worldUseCase: PublicWorldUseCase = appContainer.resolve('publicWorldUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const studioId = matchPath('/studio/:id', useLocation().pathname)?.params.id
  const ep = useSearchParams()[0].get('ep')
  const { data: items = [] } = useAsyncData(() => (open ? readingUseCase.getQuickItems(role, studioId ? { id: studioId, ep } : undefined) : Promise.resolve([])), [readingUseCase, open, role, studioId, ep])
  const query = q.trim()
  // 입력이 멈추면(TYPING_PAUSE) 세계관·설정 카드를 한 번 찾는다. 검색어가 바뀌거나 시트를 닫으면 이전 요청은 대기 중이어도 취소하고 그 응답은 버린다(useAsyncData).
  // 두 묶음은 함께 도착해 목록이 한 번만 늘고, 한 묶음이 실패하면 그 묶음만 null이다.
  const { data: near } = useAsyncData(async (signal) => {
    if (!open || !query) return undefined
    await wait(TYPING_PAUSE, signal)
    const [worlds, cards] = await Promise.allSettled([
      worldUseCase.searchWorlds({ q: query, page: 0, size: WORLD_HITS }, signal),
      worldUseCase.searchCards({ q: query, page: 0, size: WORLD_HITS }, signal),
    ])
    return { worlds: worlds.status === 'fulfilled' ? worlds.value.items : null, cards: cards.status === 'fulfilled' ? cards.value.items : null }
  }, [worldUseCase, open, query])

  useEffect(() => {
    const show = () => { if (!requestLeave()) return; setQ(''); setSel(0); setOpen(true) }
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show() } }
    window.addEventListener('sf-quick', show)
    document.addEventListener('keydown', key)
    return () => { window.removeEventListener('sf-quick', show); document.removeEventListener('keydown', key) }
  }, [])

  const found: QuickItem[] = [
    ...(near?.worlds ?? []).map((w) => ({ k: '세계관', label: w.name, sub: `${w.authorNickname} · 설정 카드 ${w.cardCount}개`, go: `/worlds/${w.id}` })),
    ...(near?.cards ?? []).map((card) => ({ k: '설정 카드', label: card.title, sub: `${card.worldName} · ${kindOf(card.cardType)}`, go: `/worlds/${card.worldId}/cards/${card.cardId}` })),
  ]
  const list: QuickItem[] = query
    ? [{ k: '검색', label: `‘${query}’ 검색 결과 모두 보기`, sub: 'Enter · 작품·세계관·설정 카드에서 찾기', go: `/search?q=${encodeURIComponent(query)}` }, ...items.filter((x) => (x.label + x.sub).includes(query)).slice(0, 7), ...found]
    : items.filter((x) => x.k === '소설' || x.k === '이동').slice(0, 8)
  const current = sel < list.length ? sel : 0

  return {
    open,
    q,
    list,
    /** 세계관·설정 카드를 불러오지 못했다(한 묶음만 실패해도 true). 목록 뒤에 안내 한 줄을 보인다. */
    failed: !!near && (near.worlds === null || near.cards === null),
    sel: current,
    setQuery: (v: string) => { setQ(v); setSel(0) },
    move: (d: number) => setSel(Math.max(0, Math.min(current + d, list.length - 1))),
    close: () => setOpen(false),
    go: (i: number) => { const item = list[i]; if (!item || !requestLeave()) return; setOpen(false); navigate(item.go) },
  }
}
