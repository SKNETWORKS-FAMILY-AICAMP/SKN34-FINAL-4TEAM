import { useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../app/appContainer'
import { useAppSelector } from '../../../app/store'
import type { ReadingUseCase } from '../../../domain/usecases/ReadingUseCase'
import { useAsyncData } from '../useAsyncData'

/** 목업 quick(): Ctrl/Cmd+K 또는 GNB 검색 버튼(sf-quick 이벤트)으로 엽니다. */
export function useQuickViewModel(readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const studioId = matchPath('/studio/:id', useLocation().pathname)?.params.id
  const ep = useSearchParams()[0].get('ep')
  const { data: items = [] } = useAsyncData(() => (open ? readingUseCase.getQuickItems(role, studioId ? { id: studioId, ep } : undefined) : Promise.resolve([])), [readingUseCase, open, role, studioId, ep])

  useEffect(() => {
    const show = () => { setQ(''); setSel(0); setOpen(true) }
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show() } }
    window.addEventListener('sf-quick', show)
    document.addEventListener('keydown', key)
    return () => { window.removeEventListener('sf-quick', show); document.removeEventListener('keydown', key) }
  }, [])

  const query = q.trim()
  const list = query
    ? [{ k: '검색', label: `‘${query}’ 검색 결과 모두 보기`, sub: 'Enter · 제목·작가·태그에서 찾기', go: `/search?q=${encodeURIComponent(query)}` }, ...items.filter((x) => (x.label + x.sub).includes(query)).slice(0, 7)]
    : items.filter((x) => x.k === '소설' || x.k === '이동').slice(0, 8)
  const current = sel < list.length ? sel : 0

  return {
    open,
    q,
    list,
    sel: current,
    setQuery: (v: string) => { setQ(v); setSel(0) },
    move: (d: number) => setSel(Math.max(0, Math.min(current + d, list.length - 1))),
    close: () => setOpen(false),
    go: (i: number) => { const item = list[i]; if (!item) return; setOpen(false); navigate(item.go) },
  }
}
