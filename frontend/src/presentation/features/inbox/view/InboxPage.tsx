import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { inboxCls } from '../../../../domain/usecases/InboxUseCase'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useInboxViewModel } from '../viewmodel/useInboxViewModel'

/** 목업 inbox(): U20 독자 피드백함. 상태 이름은 목업 그대로입니다. */
export function InboxPage() {
  const [q] = useSearchParams()
  const vm = useInboxViewModel(q.get('i'))
  const [answer, setAnswer] = useState('')
  if (!vm.data) return null
  const { items, it, current: cur } = vm.data
  return (
    <>
      <Gnb on="lib" />
      <main className="wrap">
        <div className="topbar" style={{ height: 'auto', marginBottom: 14 }}><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><h2 style={{ fontSize: 21, fontWeight: 800 }}>독자 피드백함 <span className="muted small" style={{ fontWeight: 600 }}>댓글·단순 오류·스토리 오류·질문·제안</span></h2></div>
        <div className="inbox">
          <div>{items.map((x) => (
            <Go key={x.id} to={`/inbox?i=${x.id}`} className={`ibx ${it && x.id === it.id ? 'on' : ''}`} aria-current={it && x.id === it.id ? 'true' : undefined}><div className="top"><b>{x.title} {x.n}화 · {x.type}</b><span className={`chip ${inboxCls(x.status)}`}>{x.status}</span></div><p>{x.text}</p><span className="small muted">{x.who}</span></Go>
          ))}</div>
          {it ? (
            <div className="panel"><b style={{ fontSize: 16 }}>접수된 피드백</b><dl className="ai"><dt>유형</dt><dd>{it.ai.cls}</dd><dt>안내</dt><dd>{it.ai.why}</dd><dt>참고 문장</dt><dd>{it.ai.ev}</dd></dl>
              {it.from ? <>
                <b>수정 제안 (PR)</b>
                <div className="diff"><div className="o"><small>지금</small>{cur.split(it.from).flatMap((part, i) => i ? [<del key={i}>{it.from}</del>, part] : [part])}</div>
                  <div className="n"><small>바꾸면</small>{cur.replace(it.from, it.to ?? '').split(it.to ?? '').flatMap((part, i) => i ? [<ins key={i}>{it.to}</ins>, part] : [part])}</div></div>
                <p className="small muted">영향: {it.n}화 1곳 · 줄거리·설정 변화 없음 · 이미 포크 소설의 스냅샷에는 반영되지 않음</p>
                <div className="rowend" style={{ marginTop: 14 }}>{['검토 대기', '수정 제안'].includes(it.status)
                  ? <><button type="button" className="btn" onClick={() => vm.act(it.id, 'reject')}>거절</button><button type="button" className="btn pri" id="approve" onClick={() => vm.act(it.id, 'approve')}>수정안 승인</button></>
                  : it.status === '승인됨' ? <><span className="chip wait">승인됨 · 발행 전</span><button type="button" className="btn pri" onClick={() => vm.act(it.id, 'publishRevision')}>수정안 발행</button></>
                  : <span className={`chip ${inboxCls(it.status)}`}>{it.status}</span>}</div>
              </> : <>
                <b>작가 판단이 필요해요</b><p className="small muted" style={{ margin: '6px 0 10px' }}>AI가 오류로 단정하지 않았어요. 답변을 쓰거나, 의도한 설정이면 그대로 두세요.</p>
                <textarea className="ta" id="ans" aria-label="작가 답변" value={answer} onChange={(e) => setAnswer(e.target.value)} />
                <div className="rowend" style={{ marginTop: 12 }}>{['작가 검토 대기', '작가 확인 필요'].includes(it.status)
                  ? <><button type="button" className="btn" onClick={() => vm.act(it.id, 'resolve', answer)}>의도한 설정이에요</button><button type="button" className="btn pri" onClick={() => vm.act(it.id, 'resolve', answer)}>답변 보내기</button></>
                  : <span className="chip ok">{it.status}</span>}</div>
              </>}
              <p className="note" style={{ marginTop: 16 }}>원문은 작가가 승인해야만 바뀌어요. 처리 결과는 독자의 내 서재에 바로 표시돼요.</p>
            </div>
          ) : <div className="panel muted">제보가 없어요.</div>}
        </div>
      </main>
      <Footer />
    </>
  )
}
