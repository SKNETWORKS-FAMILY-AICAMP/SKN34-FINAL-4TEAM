import { CoverOf } from '../art'
import { Sheet } from '../Sheet'
import { useQuickViewModel } from './useQuickViewModel'

/** 목업 quick() U03 빠른 이동 */
export function QuickJump() {
  const vm = useQuickViewModel()
  if (!vm.open) return null
  return (
    <Sheet sid="U03" label="빠른 이동" panelClass="qk" onClose={vm.close}>
      <input id="qi" data-autofocus aria-label="소설·인물·회차 검색" placeholder="소설·인물·회차 검색 (Enter: 전체 결과 보기)" value={vm.q}
        onChange={(e) => vm.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); vm.move(e.key === 'ArrowDown' ? 1 : -1) }
          if (e.key === 'Enter') vm.go(vm.sel)
        }} />
      <ul id="ql">
        {vm.list.length ? vm.list.map((x, i) => (
          <li key={x.k + x.label + x.go} className={i === vm.sel ? 'on' : ''} onClick={() => vm.go(i)}>
            <div className="th">{'w' in x && x.w && <CoverOf w={x.w} k="q" />}</div><div><b>{x.label}</b><small>{x.sub}</small></div><span className="chip">{x.k}</span>
          </li>
        )) : <li style={{ display: 'block', color: 'var(--sub)' }}>검색 결과가 없어요.</li>}
      </ul>
      <div className="ft"><span>↑↓ 이동</span><span>Enter 열기</span><span>Esc 닫기</span></div>
    </Sheet>
  )
}
