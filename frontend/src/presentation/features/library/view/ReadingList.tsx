import { useState } from 'react'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { CoverOf } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import { paginate } from '../../../shared/paginate'
import { Pager } from '../../../shared/Pager'

type Recent = Awaited<ReturnType<LibraryUseCase['getRead']>>['recent']

/** 이어 읽기 목록을 10개씩 나눠 보인다. 서재 탭을 옮기면 이 목록이 다시 만들어져 1쪽으로 돌아간다. */
export function ReadingList({ recent, removing, onRemove }: { recent: Recent; removing: string | null; onRemove: (workId: string) => void }) {
  const [page, setPage] = useState(1)
  const view = paginate(recent, page)
  return <>
    <div className="list">{view.items.map(({ work: w, n, tot }) => (
      <div className="li" key={w.id}><div className="th"><CoverOf w={w} /></div><div><b>{w.title}</b><div className="m">{n}화까지 읽음 · {w.genre}</div><div className="bar"><i style={{ width: `${n / tot * 100}%` }} /></div></div><div className="acts"><Go to={`/read/${w.id}/${n}`} className="btn sm pri">▶ {n}화 이어 읽기</Go><button type="button" className="btn sm" aria-label={`${w.title} 이어 읽기 기록 삭제`} disabled={!!removing} onClick={() => onRemove(w.id)}>기록 삭제</button></div></div>
    ))}</div>
    <Pager page={view.page} pages={view.pages} onPage={setPage} />
  </>
}
