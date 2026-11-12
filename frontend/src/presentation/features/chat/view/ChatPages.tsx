import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { SORTS } from '../../../../domain/entities/work'
import { CoverOf } from '../../../shared/art'
import { ago, kfmt } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { Portrait } from '../../../shared/Portrait'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useChatListViewModel, useChatViewModel } from '../viewmodel/useChatViewModel'
import './character-chat.css'

/** 목업 chatPage(wid, cn): 작품 없이 열거나 대화할 수 없으면 목록을 보여 줍니다. */
export function ChatPage() {
  const { wid, cn } = useParams()
  useDocumentTitle('캐릭터챗')
  return wid ? <ChatRoom wid={wid} cn={cn} /> : <ChatList />
}

/** 조회 실패: 빈 화면으로 숨기지 않고 알린 뒤 다시 불러오게 합니다. */
function LoadFailed({ what, retry }: { what: string; retry: () => void }) {
  return <div role="alert"><p>{what} 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={retry}>다시 불러오기</button></div>
}

/** 목업 chatListPage(): U27 캐릭터챗 목록. 틀(상단바·제목)은 조회 결과와 무관하게 늘 그립니다. */
function ChatList() {
  const [q] = useSearchParams()
  const vm = useChatListViewModel({ kind: q.get('kind') || 'all', work: q.get('work') || 'all', character: q.get('character') || 'all', sort: q.get('sort') || 'new' })
  const { data, st } = vm
  return (
    <>
      <Gnb on="chat" />
      <main className="wrap" id="main" tabIndex={-1}>
        <div className="sec-h"><h1>캐릭터챗</h1><span className="muted small">작품과 캐릭터를 골라 대화를 시작해요{data ? ` · ${data.listed.length}개` : ''}</span></div>
        {vm.isError && <LoadFailed what="캐릭터챗을" retry={vm.retry} />}
        {!data && !vm.isError && <p role="status">캐릭터챗을 불러오고 있어요.</p>}
        {data && <>
          <nav className="libtabs" aria-label="작품 유형">{([['all', '전체'], ['original', '원작'], ['fork', '포크']] as const).map(([k, l]) => (
            <Go key={k} to={vm.to({ kind: k, work: 'all', character: 'all' })} className={st.kind === k ? 'on' : ''} aria-current={st.kind === k ? 'page' : undefined}>{l}</Go>
          ))}</nav>
          <div className="panel" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '1 1 180px' }}>작품<select className="inp" id="chatWork" value={st.work} onChange={(e) => vm.go({ work: e.target.value, character: 'all' })}><option value="all">전체 작품</option>{data.works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
              <label className="field" style={{ flex: '1 1 180px' }}>캐릭터<select className="inp" id="chatCharacter" value={st.character} onChange={(e) => vm.go({ character: e.target.value })}><option value="all">전체 캐릭터</option>{data.characters.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            </div>
            <div className="eptool" style={{ margin: '12px 0 0', padding: '6px 0 0', border: 0 }}><b>정렬</b><div className="sortt">{SORTS.map(([k, l]) => <Go key={k} to={vm.to({ sort: k })} className={st.sort === k ? 'on' : ''} aria-current={st.sort === k ? 'page' : undefined}>{l}</Go>)}</div></div>
            <p className="small muted">최신순·인기순·조회순은 연결된 작품의 지표를 따릅니다. 포크는 원작과 구분해 보여요.</p>
          </div>
          <div className="rgrid">{data.listed.length ? data.listed.map(({ w, character: c, parent }) => (
            <Go key={w.id + c.n} to={`/chat/${w.id}/${encodeURIComponent(c.n)}`} className="rg" aria-label={`${c.n} · ${w.title}${w.parent ? ' · 포크' : ''}`}>
              <div className="rc"><CoverOf w={w} />{w.parent && <span className="tag if">포크</span>}</div>
              <div className="ri"><small className="g">{w.parent ? '포크' : '원작'} · {w.genre}</small><div className="chh" style={{ padding: 0, border: 0 }}><i className="pt"><Portrait name={c.n} size={36} /></i><div><b>{c.n}</b><small>{c.d}</small></div></div>
                <small>{w.title}{parent ? ` · 원작 ${parent.title}` : ''}</small><span className="m">조회 {kfmt(w.views || 0)} <i /> ♥ {kfmt(w.likes || 0)} <i /> {ago(w.upd || 0)}</span></div>
            </Go>
          )) : <p className="muted" style={{ gridColumn: '1/-1', padding: '20px 8px' }}>조건에 맞는 캐릭터챗이 없어요. 작품 유형이나 필터를 바꿔 보세요. <Go to="/chat" className="btn sm">필터 초기화</Go></p>}</div>
        </>}
      </main>
      <Footer />
    </>
  )
}

/** 질문 입력: 한 글자마다 대화 기록 전체를 다시 그리지 않도록 입력 상태를 따로 둡니다. */
function AskForm({ name, error, onAsk }: { name: string; error: string; onAsk: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  // 빈 채로 보낸 경고는 글을 쓰기 시작하면 거둡니다.
  const invalid = !!error && !text.trim()
  return (
    <>
      <form className="chf" id="chf" onSubmit={async (e) => { e.preventDefault(); if (await onAsk(text)) setText('') }}>
        <input className="inp" id="chi" aria-label={`${name}에게 질문`} placeholder={`${name}에게 물어보세요`} maxLength={120} autoComplete="off" value={text} aria-invalid={invalid} aria-describedby={invalid ? 'chi-error' : undefined} onChange={(e) => setText(e.target.value)} /><button className="btn pri">보내기</button>
      </form>
      {invalid && <p id="chi-error" role="alert" className="small chat-ask-error">{error}</p>}
    </>
  )
}

/** 목업 chatPage(wid, cn): 내가 읽은 회차까지만 아는 인물과 대화 */
function ChatRoom({ wid, cn }: { wid: string; cn?: string }) {
  const vm = useChatViewModel(wid, cn)
  const log = useRef<HTMLDivElement>(null)
  const lines = vm.data?.log.length
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [lines])
  // 목업 chatPage(): 대화할 수 없는 주소는 그대로 두고 목록을 그립니다.
  if (vm.data === null) return <ChatList />
  const d = vm.data
  const cur = d?.cur
  return (
    <>
      <Gnb on="chat" />
      <main className="wrap" id="main" tabIndex={-1}>
        <Go to="/chat" className="back">캐릭터챗 목록</Go>
        <div className="sec-h"><h1>캐릭터챗</h1><span className="muted small">내가 읽은 회차까지만 아는 인물과 이야기해요 · AI 응답은 데모</span></div>
        {vm.isError && <LoadFailed what="대화를" retry={vm.retry} />}
        {!d && !vm.isError && <p role="status">대화를 불러오고 있어요.</p>}
        {d && <div className="chatg">
          <aside className="tcard chl" aria-label="대화 상대"><h2 className="small muted">작품</h2>
            <div className="chw">{d.chatWorks.map((o) => <Go key={o.id} to={`/chat/${o.id}`} className={o.id === wid ? 'on' : ''} aria-current={o.id === wid ? 'true' : undefined}><span className="th"><CoverOf w={o} /></span>{o.title}{o.parent ? ' · 포크' : ''}</Go>)}</div>
            <h2 className="small muted" style={{ marginTop: 14 }}>인물 <span style={{ fontWeight: 500 }}>· {d.read ? d.read + '화까지 읽음' : '아직 안 읽음 · 1화 기준'}</span></h2>
            {d.cs.length ? d.cs.map((c) => { const on = !!cur && c.n === cur.n; return <Go key={c.n} to={`/chat/${wid}/${encodeURIComponent(c.n)}`} className={`chc ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}><i className="pt"><Portrait name={c.n} size={36} /></i><div><b>{c.n}</b><small>{c.d}</small></div></Go> }) : <p className="small muted">대화할 수 있는 인물이 없어요.</p>}
          </aside>
          <section className="tcard chm" aria-labelledby={cur ? 'chat-with' : undefined}>{cur ? <>
            <div className="chh"><i className="pt"><Portrait name={cur.n} size={36} /></i><div><b id="chat-with">{cur.n}</b><small>{d.w.title} · {d.base}화 시점의 기억</small></div></div>
            <div className="chlog" id="chlog" ref={log} role="log" aria-live="polite" aria-label={`${cur.n} 대화 기록`} tabIndex={0}>{d.log.map((m, i) => m[0] === '나'
              ? <div className="me" key={i}><span className="sr-only">나</span><p>{m[1]}</p></div>
              : <div className="they" key={i}><i className="pt"><Portrait name={cur.n} size={36} /></i><div><span className="sr-only">{cur.n}</span><p>{m[1]}</p>{m[2] && <span className="ev">{m[2]}</span>}</div></div>)}</div>
            <div className="chq" role="group" aria-label="추천 질문">{d.questions.map((x, i) => <button type="button" key={i} onClick={() => vm.ask({ q: i })}>{x[0] > d.base ? '🔒 ' : ''}{x[1]}</button>)}</div>
            <AskForm key={d.key} name={cur.n} error={vm.askError} onAsk={(text) => vm.ask({ text })} />
            {d.forkAt && <div className="chfork"><span>대화하다 떠오른 전개가 있나요?</span><Go to={`/fork/${wid}?at=${d.forkAt}`} className="btn sm">✎ {d.forkAt}화에서 포크하기</Go></div>}
          </> : <p className="muted">대화할 수 있는 인물이 없어요.</p>}</section>
        </div>}
      </main>
      <Footer />
    </>
  )
}
