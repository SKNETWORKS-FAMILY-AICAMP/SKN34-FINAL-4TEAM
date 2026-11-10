import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { type InboxAct, inboxCls } from '../../../../domain/usecases/InboxUseCase'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useInboxViewModel } from '../viewmodel/useInboxViewModel'
import { FeedbackReportInbox } from './FeedbackReportInbox'

/** 목업 inbox(): U20 독자 피드백함. 상태 이름은 목업 그대로입니다. */
export function InboxPage() {
  const [q] = useSearchParams()
  const vm = useInboxViewModel(q.get('i'))
  useDocumentTitle('독자 피드백함')
  const [answer, setAnswer] = useState('')
  // 목업 inbox()는 항목이 바뀔 때마다 #ans를 새로 그립니다.
  const [shown, setShown] = useState(vm.data?.it?.id)
  if (shown !== vm.data?.it?.id) { setShown(vm.data?.it?.id); setAnswer('') }
  const status = useRef<HTMLParagraphElement>(null)
  // 처리한 버튼이 사라지거나 잠겨 초점을 잃어도 결과 안내에서 이어 가게 합니다.
  useEffect(() => { if (vm.notice) status.current?.focus() }, [vm.notice])
  const top = <div className="topbar" style={{ height: 'auto', marginBottom: 14 }}><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><h1 style={{ fontSize: 21, fontWeight: 800 }}>독자 피드백함 <span className="muted small" style={{ fontWeight: 600 }}>댓글·단순 오류·스토리 오류·질문·제안</span></h1></div>
  if (!vm.data) return <><Gnb on="lib" /><main id="main" tabIndex={-1} className="wrap">{top}<FeedbackReportInbox /><p className="muted" role="status">독자 피드백을 불러오고 있어요.</p></main><Footer /></>
  const { items, it, current: cur } = vm.data
  const act = (kind: InboxAct, text?: string) => it && vm.act(it.id, kind, text)
  // 발행(publishRevision)은 첫 번째 일치만 바꾸므로, 미리보기도 그 위치에서 앞·뒤를 나눠 그립니다.
  const from = it?.from ?? '', at = cur.indexOf(from)
  const [head, tail] = at < 0 ? [cur, ''] : [cur.slice(0, at), cur.slice(at + from.length)]
  return (
    <>
      <Gnb on="lib" />
      <main id="main" tabIndex={-1} className="wrap">
        {top}
        <FeedbackReportInbox />
        {it && (
          <section className="sec" aria-label="데모 작품 피드백">
            <div className="sec-h"><h2>데모 작품 피드백 · 서버에 저장되지 않아요</h2></div>
            <div className="inbox">
              <div>{items.map((x) => (
                <Go key={x.id} to={`/inbox?i=${x.id}`} className={`ibx ${it && x.id === it.id ? 'on' : ''}`} aria-current={it && x.id === it.id ? 'true' : undefined}><div className="top"><b>{x.title} {x.n}화 · {x.type}</b><span className={`chip ${inboxCls(x.status)}`}>{x.status}</span></div><p>{x.text}</p><span className="small muted">{x.who}</span></Go>
              ))}</div>
              <div className="panel" aria-busy={vm.pending}><b style={{ fontSize: 16 }}>접수된 피드백</b>
                {vm.notice?.id === it.id && <p ref={status} role="status" tabIndex={-1}>{vm.notice.msg}</p>}<dl className="ai"><dt>유형</dt><dd>{it.ai.cls}</dd><dt>안내</dt><dd>{it.ai.why}</dd><dt>참고 문장</dt><dd>{it.ai.ev}</dd></dl>
                {it.from ? <>
                  <b>수정 제안 (PR)</b>
                  <div className="diff"><div className="o"><small>지금</small>{head}{at >= 0 && <del>{from}</del>}{tail}</div>
                    <div className="n"><small>바꾸면</small>{head}{at >= 0 && <ins>{it.to}</ins>}{tail}</div></div>
                  <p className="small muted">영향: {it.n}화 1곳 · 줄거리·설정 변화 없음 · 이미 포크 소설의 스냅샷에는 반영되지 않음</p>
                  <div className="rowend" style={{ marginTop: 14 }}>{['검토 대기', '수정 제안', '작가 검토 대기'].includes(it.status)
                    ? <><button type="button" className="btn" disabled={vm.pending} onClick={() => act('reject')}>거절</button><button type="button" className="btn pri" id="approve" disabled={vm.pending} onClick={() => act('approve')}>수정안 승인</button></>
                    : it.status === '승인됨' ? <><span className="chip wait">승인됨 · 발행 전</span><button type="button" className="btn pri" disabled={vm.pending} onClick={() => act('publishRevision')}>수정안 발행</button></>
                    : <><span className={`chip ${inboxCls(it.status)}`}>{it.status}</span>{it.status === '반영 실패' && <button type="button" className="btn" disabled={vm.pending} onClick={() => act('reject')}>거절</button>}</>}</div>
                </> : <>
                  <b>작가 판단이 필요해요</b><p className="small muted" style={{ margin: '6px 0 10px' }}>AI가 오류로 단정하지 않았어요. 답변을 쓰거나, 의도한 설정이면 그대로 두세요.</p>
                  <textarea className="ta" id="ans" aria-label="작가 답변" readOnly={vm.pending} value={answer} onChange={(e) => setAnswer(e.target.value)} />
                  <div className="rowend" style={{ marginTop: 12 }}>{['작가 검토 대기', '작가 확인 필요'].includes(it.status)
                    ? <><button type="button" className="btn" disabled={vm.pending} onClick={() => act('resolve', answer)}>의도한 설정이에요</button><button type="button" className="btn pri" disabled={vm.pending} onClick={() => act('resolve', answer)}>답변 보내기</button></>
                    : <span className="chip ok">{it.status}</span>}</div>
                </>}
                <p className="note" style={{ marginTop: 16 }}>원문은 작가가 승인해야만 바뀌어요. 처리 결과는 독자의 내 서재에 바로 표시돼요.</p>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}
