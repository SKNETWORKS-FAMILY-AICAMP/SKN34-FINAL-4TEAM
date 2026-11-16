import { useEffect, useId, useRef, useState } from 'react'

import { FEEDBACK_TYPES, REPORT_TYPES, type FeedbackType, type Sentence } from '../../../../domain/entities/feedback'
import { REPORT_BODY_MAX, REPORT_VISIBILITY_LABEL, type FeedbackReportVisibility } from '../../../../domain/entities/feedbackReport'
import type { Work } from '../../../../domain/entities/work'
import type { Look } from '../../../shared/ui/uiSlice'
import { ReportWorkForm } from '../../../shared/reports/ReportWorkForm'
import { Sheet } from '../../../shared/Sheet'
import { useFeedbackViewModel } from '../viewmodel/useFeedbackViewModel'
import { useInlineFailure } from '../viewmodel/useInlineFailure'
import { useLook } from '../viewmodel/useLook'

const Head = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="sh-h"><h3>{title}</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
)

/** 입력 거절·실패 사유. 시트가 열려 있는 동안은 사라지지 않고 시트 안에 남는다. */
const Failure = ({ error }: { error: string | null }) => error && <p role="alert">{error}</p>

/**
 * 접수 결과. 제출 버튼이 사라진 자리에서 키보드 위치를 잃지 않게 '확인'으로 포커스를 옮기고,
 * 결과 문구는 상태(role=status)이자 그 버튼의 설명이라 포커스가 닿을 때 함께 읽힌다.
 */
function Done({ status, message, onClose }: { status: string; message: string; onClose: () => void }) {
  const result = useId()
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => { ok.current?.focus() }, [])
  return (
    <>
      <div className="reply" role="status" id={result}><span className={`chip ${['접수됨', '작가 확인 전', '작가 검토 대기', '분석 중', '필터 대기'].includes(status) ? 'wait' : 'ok'}`}>{status}</span> {message}</div>
      <div className="rowend"><button ref={ok} type="button" className="btn pri" aria-describedby={result} onClick={onClose}>확인</button></div>
    </>
  )
}

/** 보낼 내용이 있을 때만 제출 버튼을 잠급니다. 빈 내용은 ViewModel이 안내만 하고 거절하므로(제출이 시작되지 않음) 바로 다시 누를 수 있어야 합니다. */
const willSubmit = (text: string) => text.trim() !== ''

/** 소설 전체 신고 시트. 서버(Content API) 작품은 운영 신고 API(34)로 접수하고, 데모 작품은 메모리 데모로 접수합니다. */
export function ReportSheet({ work, onClose }: { work: Work; onClose: () => void }) {
  if (!work.canonical) return <DemoReportSheet work={work} onClose={onClose} />
  return (
    <Sheet sid="U06" label="소설 신고" onClose={onClose}>
      <Head title={`🚩 소설 신고 · ${work.title}`} onClose={onClose} />
      <ReportWorkForm key={work.id} workId={work.id} workTitle={work.title} alwaysOpen />
    </Sheet>
  )
}

/** 목업 reportSheet(id): 소설 전체 신고 */
function DemoReportSheet({ work, onClose }: { work: Work; onClose: () => void }) {
  const vm = useFeedbackViewModel()
  const [type, setType] = useState(REPORT_TYPES[0][0])
  const [text, setText] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const failure = useInlineFailure()
  return (
    <Sheet sid="U06" label="소설 신고" onClose={onClose}>
      <Head title={`🚩 소설 신고 · ${work.title}`} onClose={onClose} />
      <p className="small muted" style={{ margin: '6px 0 12px' }}>문장별 신고가 아니라 소설 전체에 대한 신고예요.</p>
      <label className="field">신고 유형
        <select className="inp" aria-label="신고 유형" disabled={!!done} value={type} onChange={(e) => setType(e.target.value)}>{REPORT_TYPES.map(([k]) => <option key={k}>{k}</option>)}</select>
        <small className="muted">{REPORT_TYPES.find((x) => x[0] === type)?.[1]}</small>
      </label>
      <label className="field">신고 내용<textarea className="ta" aria-label="신고 내용" data-autofocus maxLength={1000} readOnly={!!done} placeholder="확인이 필요한 내용을 적어 주세요" value={text} onChange={(e) => setText(e.target.value)} /></label>
      {done ? <Done status="접수됨" message={done} onClose={onClose} /> : (
        <>
          <p className="note">권리 침해·유해 콘텐츠 신고는 운영팀이 검토해요. 피드백과 별도로 처리돼요.</p>
          <Failure error={failure.error} />
          <div className="rowend"><button type="button" className="btn" onClick={onClose}>취소</button><button type="button" className="btn pri" disabled={busy} onClick={() => { failure.clear(); setBusy(willSubmit(text)); void vm.reportWork(work.id, type, text, failure.fail).then((m) => m && setDone(m)).finally(() => setBusy(false)) }}>신고하기</button></div>
        </>
      )}
    </Sheet>
  )
}

/**
 * 목업 commentSheet(id,n,k): 문장에 댓글 달기. 서버 작품은 submit으로 서버에 보내고 글자 수 한도도 서버 계약(maxLength)을 따릅니다.
 * submit은 실패 사유를 넘겨받은 fail로 알려 시트 안에 남깁니다.
 */
export function CommentSheet({ workId, n, sentence, onClose, onAdded, submit, maxLength = 200 }: { workId: string; n: number; sentence: Sentence; onClose: () => void; onAdded?: () => void; submit?: (text: string, sentence: Sentence, spoiler: boolean, fail: (message: string) => void) => Promise<boolean>; maxLength?: number }) {
  const vm = useFeedbackViewModel()
  const [text, setText] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const [busy, setBusy] = useState(false)
  const failure = useInlineFailure()
  return (
    <Sheet sid="U06" label="문장에 댓글 달기" onClose={onClose}>
      <Head title={`${n}화 문장에 댓글 달기`} onClose={onClose} />
      <div className="quote">{sentence.t}</div>
      <label className="field">댓글<textarea className="ta" id="ct" aria-label="댓글" data-autofocus maxLength={maxLength} placeholder="감상, 의견, 궁금한 점을 자유롭게 남겨 주세요" value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label className="ck"><input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /> 스포일러 표시</label>
      <div className="note">댓글만 등록되며 자동 답변은 제공하지 않아요.</div>
      <Failure error={failure.error} />
      <div className="rowend">
        <button type="button" className="btn" onClick={onClose}>취소</button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => { failure.clear(); setBusy(willSubmit(text)); void (submit ? submit(text, sentence, spoiler, failure.fail) : vm.addComment(workId, n, text, sentence, spoiler, failure.fail)).then((ok) => { if (ok) { onClose(); onAdded?.() } }).finally(() => setBusy(false)) }}>등록</button>
      </div>
    </Sheet>
  )
}

/**
 * 목업 feedbackSheet(id,n,k): 피드백은 운영 신고와 별도로 접수합니다.
 * canonical(실제 작품)이면 유형·내용·공개 범위를 서버 제보 API(기능 23)로 등록하고, AI 시뮬레이션·자동 응답 문구 없이 실제 응답 상태만 안내합니다. onSent는 등록 성공 뒤 호출됩니다.
 */
export function FeedbackSheet({ workId, n, sentence, onClose, canonical = false, onSent }: { workId: string; n: number; sentence: Sentence; onClose: () => void; canonical?: boolean; onSent?: () => void }) {
  const vm = useFeedbackViewModel()
  const [type, setType] = useState<FeedbackType>(FEEDBACK_TYPES[0])
  const [text, setText] = useState('')
  const [storyCheck, setStoryCheck] = useState(false)
  const [visibility, setVisibility] = useState<FeedbackReportVisibility>('private')
  const [done, setDone] = useState<{ status: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const failure = useInlineFailure()
  return (
    <Sheet sid="U06" label="피드백 보내기" onClose={onClose}>
      <Head title={`✉ 피드백 보내기 · ${n}화`} onClose={onClose} />
      <div className="quote">{sentence.t}</div>
      <label className="field">피드백 유형
        <select className="inp" id="ftype" aria-label="피드백 유형" disabled={!!done} value={type} onChange={(e) => setType(FEEDBACK_TYPES.find((t) => t === e.target.value) ?? FEEDBACK_TYPES[0])}>{FEEDBACK_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      <label className="field">내용<textarea className="ta" id="ft" aria-label="내용" data-autofocus maxLength={canonical ? REPORT_BODY_MAX : 1000} readOnly={!!done} value={text} onChange={(e) => setText(e.target.value)} /></label>
      {canonical && (
        <label className="field">공개 범위
          <select className="inp" id="fvis" aria-label="공개 범위" disabled={!!done} value={visibility} onChange={(e) => setVisibility(e.target.value === 'public' ? 'public' : 'private')}>
            <option value="private">{REPORT_VISIBILITY_LABEL.private} · 작가와 나만 봐요</option>
            <option value="public">{REPORT_VISIBILITY_LABEL.public} · 다른 독자도 회차 하단에서 봐요</option>
          </select>
        </label>
      )}
      {canonical ? <p className="note">제보는 작가에게 전달되고, 작가가 확인하거나 답변하면 상태가 바뀌어요. 내 서재의 ‘내 댓글·제보’에서 정정·철회·공개 범위 변경을 할 수 있어요. 자동 분석이나 자동 답변은 없어요.</p> : type === '스토리 오류' && !done ? (
        <>
          <label className="ck"><input type="checkbox" checked={storyCheck} onChange={(e) => setStoryCheck(e.target.checked)} /> 스토리 오류 검증 시뮬레이션에 동의</label>
          <p className="note">기본 피드백은 무료예요. 선택 검증의 비용과 한도는 미정이며, 이 데모는 실제 AI 호출이나 차감이 없어요. 오류가 검증·반영되면 보상 크레딧을 줄 수 있지만 실제 보상은 연결되지 않았어요. 정식 서비스의 유해 콘텐츠 1차 필터는 연결되지 않았어요.</p>
        </>
      ) : <p className="note">댓글·단순 오류·스토리 오류·질문·제안은 무료로 등록돼요. 정식 서비스는 단순 오류·질문에 공개 근거 기반 응답을 제안하고, 스토리 오류·제안은 작가 검토로 전달해요. 유해 콘텐츠 1차 필터는 이 데모에 연결되지 않았어요.</p>}
      {done ? <Done status={done.status} message={done.message} onClose={onClose} /> : (
        <>
          <Failure error={failure.error} />
          <div className="rowend">
            <button type="button" className="btn" onClick={onClose}>취소</button>
            <button type="button" className="btn pri" disabled={busy} onClick={() => { failure.clear(); setBusy(willSubmit(text)); void vm.sendFeedback({ workId, n, sentence, type, text, storyCheck, canonical, visibility }, failure.fail).then((r) => { if (r) { setDone(r); onSent?.() } }).finally(() => setBusy(false)) }}>피드백 보내기</button>
          </div>
        </>
      )}
    </Sheet>
  )
}

const LOOKS: [Look, string][] = [['auto', '자동'], ['world', '소설 분위기'], ['ivory', '아이보리'], ['white', '흰색'], ['night', '야간']]

/** 목업 lookSheet(): U07 보기 설정 */
export function LookSheet({ onClose }: { onClose: () => void }) {
  const { look, motion, fs, setLook, setMotion, changeFs } = useLook()
  return (
    <Sheet sid="U07" label="보기 설정" onClose={onClose}>
      <Head title="보기 설정" onClose={onClose} />
      {/* 묶음마다 이름을 준다. 이름이 없으면 '켜기'·'끄기'가 무엇의 선택인지 화면 읽기 프로그램이 알 수 없다. */}
      <div className="field">배경<div className="seg seg5" role="group" aria-label="배경">{LOOKS.map(([k, l]) => <button type="button" key={k} className={look === k ? 'on' : ''} aria-pressed={look === k} onClick={() => setLook(k)}>{l}</button>)}</div></div>
      <div className="field">배경 움직임<div className="seg" role="group" aria-label="배경 움직임"><button type="button" className={motion ? 'on' : ''} aria-pressed={motion} onClick={() => setMotion(true)}>켜기</button><button type="button" className={motion ? '' : 'on'} aria-pressed={!motion} onClick={() => setMotion(false)}>끄기</button></div></div>
      {/* 가운데 값은 누를 것이 없는 표시라 버튼이 아니다. output(상태)이라 크기를 바꾸면 새 값이 읽힌다. */}
      <div className="field">글자 크기<div className="seg" role="group" aria-label="글자 크기"><button type="button" onClick={() => changeFs(-1)}>가 −</button><output style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink)' }}><span className="sr-only">글자 크기 </span>{fs}</output><button type="button" onClick={() => changeFs(1)}>가 +</button></div></div>
      <div className="note">‘자동’은 라이트 모드에서 소설 분위기(꽃잎·반딧불·빗줄기), 다크 모드에서 차분한 기본 배경이에요. 움직임이 신경 쓰이면 ‘배경 움직임 끄기’를 누르세요.</div>
    </Sheet>
  )
}
