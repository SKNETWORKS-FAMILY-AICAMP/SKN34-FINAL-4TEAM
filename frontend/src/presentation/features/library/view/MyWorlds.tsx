import { useState } from 'react'
import { Go } from '../../../shared/Go'
import { paginate } from '../viewmodel/paginate'
import { useMyWorlds } from '../viewmodel/useMyWorlds'
import { Pager } from './Pager'
import './server-writing.css'

/** 서재의 '내가 만드는 세계관' 탭. 집필 중인 작품과 같은 가로 카드이고 `.server-writing` 스타일을 함께 쓴다. */
export function MyWorlds() {
  const vm = useMyWorlds()
  const [page, setPage] = useState(1)
  const view = paginate(vm.worlds, page)
  return <section className="server-writing" aria-label="내가 만드는 세계관" aria-busy={vm.loading}>
    <div className="sec-h"><h2>내가 만드는 세계관</h2><Go className="btn sm pri" to="/worldstudio">+ 새 세계관</Go></div>
    {vm.error ? <div className="server-writing-error"><p role="alert">세계관을 불러오지 못했어요.</p><button type="button" className="btn sm" onClick={vm.reload}>다시 시도</button></div>
      : vm.loading ? <p role="status">세계관을 불러오고 있어요…</p>
      : !vm.worlds.length ? <p className="note2">아직 만든 세계관이 없어요.</p>
      : <>
        <div className="list">{view.items.map(world => <article className="li" key={world.id}>
          {/* ponytail: 세계관 표지는 API 연결은 후속이라 지금은 기본 표지만 둔다. */}
          <div className="th"><img className="cimg" src="/default-work-cover.svg" alt="" /></div>
          <div className="server-writing-content"><h3>{world.name}</h3>
            <div className="m">설정 {world.settings.length}개 · 버전 {world.version}</div>
          </div>
          <div className="acts">
            <Go className="btn sm pri" to={`/worldstudio/${world.id}`} aria-label={`${world.name} 세계관 열기`}>세계관 열기</Go>
          </div>
        </article>)}</div>
        <Pager page={view.page} pages={view.pages} onPage={setPage} />
      </>}
  </section>
}
