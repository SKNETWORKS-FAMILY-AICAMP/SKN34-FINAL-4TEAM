import { Cov, CoverOf } from '../../../shared/art'
import { kfmt } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { PublishSettingsSheet } from '../../../shared/PublishSettingsSheet'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useLibraryViewModel } from '../viewmodel/useLibraryViewModel'
import { MyWorlds } from './MyWorlds'
import { ReadingList } from './ReadingList'
import { ServerWritingList } from './ServerWritingList'

const TABS = [['read', '읽는 중'], ['write', '내가 쓰는 소설'], ['worlds', '내가 만드는 세계관']] as const

/** 목업 lib(): U11 내 서재 (읽는 중·내가 쓰는 소설·내가 만드는 세계관) */
export function LibraryPage() {
  const vm = useLibraryViewModel()
  const d = vm.data
  useDocumentTitle('내 서재')
  if (!d) return <><Gnb on="lib"/><main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry}/></main></>
  // 서버가 없는 목업 빌드는 읽기 기록도 메모리라 안내가 다르다. 정적 JSX에 두면 모듈 로드 때 한 번만 평가되므로 렌더 시점 변수로 읽는다.
  const mockup = import.meta.env.MODE === 'mockup'
  return (
    <>
      <Gnb on="lib" />
      <main id="main" tabIndex={-1} className="wrap">
        <div className="sec-h" style={{ marginBottom: 0 }}><h1>내 서재</h1><span className="muted small">읽기와 쓰기를 한 계정에서 해요</span></div>
        <nav className="libtabs">{TABS.map(([k, l]) => <Go key={k} to={`/lib?tab=${k}`} className={d.tab === k ? 'on' : ''} aria-current={d.tab === k ? 'page' : undefined}>{l}{k === 'write' && d.pending > 0 && <span className="nb">{d.pending}</span>}</Go>)}</nav>
        {d.read && (
          <>
            <p className="note2">{mockup
              ? '읽기 기록과 관심 소설은 이 창에서만 유지돼요. 계정에 저장하거나 다른 기기와 동기화하지 않아요.'
              : '이어 읽기 기록과 관심 소설은 계정에 저장돼요.'}</p>
            <div className="sec-h"><h2>이어 읽기</h2></div>
            <ReadingList recent={d.read.recent} removing={d.removing} onRemove={d.removeReading} />
            <div className="sec"><div className="sec-h"><h2>관심 소설</h2></div>{d.read.liked.length
              ? <div className="grid6">{d.read.liked.map((w) => <Go key={w.id} to={`/work/${w.id}`} className="bk prox"><Cov w={w} likes /><span className="hk">{w.title}</span></Go>)}</div>
              : <div className="list"><div className="rp muted">소설 화면에서 '관심 등록'을 누르면 여기에 모여요.</div></div>}</div>
          </>
        )}
        {d.write && (
          <>
            <ServerWritingList />
            {d.write.mine.length > 0 && <section className="sec" aria-label="데모 작품"><h2>데모 작품 · 서버에 저장되지 않아요</h2>
            {d.write.appeals.map((q) => (
              <form className="panel" key={q.id} aria-label={`${q.title} · 권리 신고 소명`} onSubmit={(e) => { e.preventDefault(); d.appeal(q.id, new FormData(e.currentTarget).get('appeal')?.toString() ?? '') }}>
                <b>{q.title} · 권리 신고 소명</b><p className="small muted">신고 내용: {q.text}. 검토 중 작품이 제한되어 있어요.</p>
                <label className="field">소명 내용<textarea className="ta" name="appeal" maxLength={1000} required /></label><button className="btn sm pri">소명 제출</button>
              </form>
            ))}
            {d.write.mine.map(({ work: w, parent, writingNext, pub, forkLabel, forkCount }) => (
              <div className="mywork" data-work={w.id} key={w.id}><div className="th"><CoverOf w={w} /></div><div><h3>{w.title}</h3>
                <div className="tags">{parent ? <span className="chip ok">포크 · {parent.title} {w.forkAt}화에서</span> : <span className="chip">{w.kind}</span>}{pub ? <span className="chip ok">공개 중</span> : <span className="chip wait">비공개 · 작성 중</span>}{!w.parent && <span className="chip">{forkLabel}</span>}</div>
                <div className="small muted">{w.parent ? `원작 스냅샷 ${w.forkAt}화 + 내가 쓴 ${w.eps.length}화${writingNext ? ' · 다음 화 초안 작성 중' : ''}` : `${w.eps.length}화 · ♥ ${kfmt(w.likes)} · 포크 소설 ${forkCount}편`}</div>
                <div className="acts" style={{ marginTop: 12 }}><Go to={`/studio/${w.id}`} className="btn sm pri">✎ 쓰기</Go>{!w.parent
                  ? <><Go to="/inbox" className="btn sm">독자 피드백함{d.pending > 0 && w.id === 'starlight' && <span className="badge-n">{d.pending}</span>}</Go><button type="button" className="btn sm" onClick={() => d.openPublish(w.id)}>공개 설정</button></>
                  : <><Go to={`/work/${w.id}`} className="btn sm">소설 화면</Go><Go to={`/work/${w.parent}`} className="btn sm">원작 보기</Go></>}</div>
              </div></div>
            ))}
            </section>}
            <div className="sec"><div className="sec-h"><h2>새로 시작하기</h2></div>{mockup && <p className="note2">새 소설 등록·가져오기 양식의 일괄 저장은 아직 지원하지 않아요. 허용된 회차의 포크 생성은 서버에 저장돼요.</p>}<div className="newbox">
              <Go to={mockup ? '/new' : '/content'} className="newc" id="newWork"><b>＋ 새 소설 쓰기</b><span>{mockup ? '세계관·인물을 정하고 1화부터 직접 써요 (오리지널)' : '비공개 작품을 만들고 1화부터 써요'}</span></Go>
              <Go to="/writing-policy?method=import" className="newc"><b>＋ 내 소설 가져오기</b><span>{mockup ? '예시 원고로 세계관·인물·사건 정리 흐름을 살펴봐요 (가상 추출)' : 'TXT·EPUB 원고를 내 작품의 회차로 등록해요'}</span></Go>
              <Go to="/writing-policy?method=fork" className="newc"><b>✎ 다른 소설 포크</b><span>원작을 고르고 마음에 드는 회차에서 시작해요</span></Go>
            </div></div>
          </>
        )}
        {d.tab === 'worlds' && <MyWorlds />}
      </main>
      {d.publishing && <PublishSettingsSheet work={d.publishing} onSave={d.savePublish} onClose={d.closePublish} />}
      <Footer />
    </>
  )
}
