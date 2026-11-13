import { useState } from 'react'
import { Go } from '../../../shared/Go'
import { paginate } from '../../../shared/paginate'
import { Pager } from '../../../shared/Pager'
import { useMyWorlds } from '../viewmodel/useMyWorlds'
import './server-writing.css'

/** 서재의 '내가 만드는 세계관' 탭. 집필 중인 작품과 같은 가로 카드이고 `.server-writing` 스타일을 함께 쓴다. */
export function MyWorlds() {
  const vm = useMyWorlds()
  const [page, setPage] = useState(1)
  const view = paginate(vm.worlds, page)
  return <>
    <section className="server-writing" aria-label="내가 만드는 세계관" aria-busy={vm.loading}>
      <div className="sec-h"><h2>내가 만드는 세계관</h2></div>
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
              <Go className="btn sm" to={`/worldstudio/${world.id}`} aria-label={`${world.name} 관리하기`}>관리하기</Go>
            </div>
          </article>)}</div>
          <Pager page={view.page} pages={view.pages} onPage={setPage} />
        </>}
    </section>
    {/* 작품 탭의 '새로 시작하기'와 같은 마크업이다. 목록을 못 불러와도 시작할 수 있게 목록 상태와 따로 둔다. */}
    <div className="sec"><div className="sec-h"><h2>새로 시작하기</h2></div><div className="newbox">
      <Go to="/worldstudio" className="newc"><b>＋ 새 세계관 만들기</b><span>비공개 세계관을 만들고 설정부터 채워요</span></Go>
      {/* ponytail: AI 후보 검토(InitialWorldReview)는 작업실 안의 도구라 직접 진입 주소가 없고 입력도 원고가 아닌 저장한 세계관 초안이다. 주소가 생기면 여기로 연결. */}
      <Go to="/worldstudio" className="newc"><b>＋ 원고로 세계관 정리하기</b><span>세계관을 만든 뒤 저장한 초안에서 AI 설정 후보를 받아요</span></Go>
      <Go to="/worlds" className="newc"><b>✎ 공개 세계관 둘러보기</b><span>다른 작가의 공개 세계관을 살펴봐요 (파생은 준비 중)</span></Go>
    </div></div>
  </>
}
