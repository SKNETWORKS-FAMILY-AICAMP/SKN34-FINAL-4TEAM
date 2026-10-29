import { useState } from 'react'

import { FEEDBACK_TYPES, REPORT_TYPES, type FeedbackType, type Sentence } from '../../../../domain/entities/feedback'
import type { Work } from '../../../../domain/entities/work'
import type { Look } from '../../../shared/session/sessionSlice'
import { Sheet } from '../../../shared/Sheet'
import { useFeedbackViewModel } from '../viewmodel/useFeedbackViewModel'
import { useLook } from '../viewmodel/useLook'

const Head = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="sh-h"><h3>{title}</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
)

const Done = ({ status, message, onClose }: { status: string; message: string; onClose: () => void }) => (
  <>
    <div className="reply"><span className={`chip ${['접수됨', '작가 검토 대기', '분석 중', '필터 대기'].includes(status) ? 'wait' : 'ok'}`}>{status}</span> {message}</div>
    <div className="rowend"><button type="button" className="btn pri" onClick={onClose}>확인</button></div>
  </>
)

/** 목업 reportSheet(id): 소설 전체 신고 */
export function ReportSheet({ work, onClose }: { work: Work; onClose: () => void }) {
  const vm = useFeedbackViewModel()
  const [type, setType] = useState(REPORT_TYPES[0][0])
  const [text, setText] = useState('')
  const [done, setDone] = useState<string | null>(null)
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
          <div className="rowend"><button type="button" className="btn" onClick={onClose}>취소</button><button type="button" className="btn pri" onClick={() => void vm.reportWork(work.id, type, text).then((m) => m && setDone(m))}>신고하기</button></div>
        </>
      )}
    </Sheet>
  )
}

/** 목업 commentSheet(id,n,k): 문장에 댓글 달기 */
export function CommentSheet({ workId, n, sentence, onClose, onAdded }: { workId: string; n: number; sentence: Sentence; onClose: () => void; onAdded: () => void }) {
  const vm = useFeedbackViewModel()
  const [text, setText] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  return (
    <Sheet sid="U06" label="문장에 댓글 달기" onClose={onClose}>
      <Head title={`${n}화 문장에 댓글 달기`} onClose={onClose} />
      <div className="quote">{sentence.t}</div>
      <label className="field">댓글<textarea className="ta" id="ct" aria-label="댓글" data-autofocus maxLength={200} placeholder="감상, 의견, 궁금한 점을 자유롭게 남겨 주세요" value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label className="ck"><input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /> 스포일러 표시</label>
      <div className="note">댓글만 등록되며 자동 답변은 제공하지 않아요.</div>
      <div className="rowend">
        <button type="button" className="btn" onClick={onClose}>취소</button>
        <button type="button" className="btn pri" onClick={() => void vm.addComment(workId, n, text, sentence, spoiler).then((ok) => { if (ok) { onClose(); onAdded() } })}>등록</button>
      </div>
    </Sheet>
  )
}

/** 목업 feedbackSheet(id,n,k): 피드백은 운영 신고와 별도로 접수합니다. */
export function FeedbackSheet({ workId, n, sentence, onClose }: { workId: string; n: number; sentence: Sentence; onClose: () => void }) {
  const vm = useFeedbackViewModel()
  const [type, setType] = useState<FeedbackType>(FEEDBACK_TYPES[0])
  const [text, setText] = useState('')
  const [storyCheck, setStoryCheck] = useState(false)
  const [done, setDone] = useState<{ status: string; message: string } | null>(null)
  return (
    <Sheet sid="U06" label="피드백 보내기" onClose={onClose}>
      <Head title={`✉ 피드백 보내기 · ${n}화`} onClose={onClose} />
      <div className="quote">{sentence.t}</div>
      <label className="field">피드백 유형
        <select className="inp" id="ftype" aria-label="피드백 유형" disabled={!!done} value={type} onChange={(e) => setType(FEEDBACK_TYPES.find((t) => t === e.target.value) ?? FEEDBACK_TYPES[0])}>{FEEDBACK_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      <label className="field">내용<textarea className="ta" id="ft" aria-label="내용" data-autofocus maxLength={1000} readOnly={!!done} value={text} onChange={(e) => setText(e.target.value)} /></label>
      {type === '스토리 오류' && !done ? (
        <>
          <label className="ck"><input type="checkbox" checked={storyCheck} onChange={(e) => setStoryCheck(e.target.checked)} /> 스토리 오류 검증 시뮬레이션에 동의</label>
          <p className="note">기본 피드백은 무료예요. 선택 검증의 비용과 한도는 미정이며, 이 데모는 실제 AI 호출이나 차감이 없어요. 오류가 검증·반영되면 보상 크레딧을 줄 수 있지만 실제 보상은 연결되지 않았어요. 정식 서비스의 유해 콘텐츠 1차 필터는 연결되지 않았어요.</p>
        </>
      ) : <p className="note">댓글·단순 오류·스토리 오류·질문·제안은 무료로 등록돼요. 정식 서비스는 단순 오류·질문에 공개 근거 기반 응답을 제안하고, 스토리 오류·제안은 작가 검토로 전달해요. 유해 콘텐츠 1차 필터는 이 데모에 연결되지 않았어요.</p>}
      {done ? <Done status={done.status} message={done.message} onClose={onClose} /> : (
        <div className="rowend">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn pri" onClick={() => void vm.sendFeedback({ workId, n, sentence, type, text, storyCheck }).then((r) => r && setDone(r))}>피드백 보내기</button>
        </div>
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
      <div className="field">배경<div className="seg seg5">{LOOKS.map(([k, l]) => <button type="button" key={k} className={look === k ? 'on' : ''} aria-pressed={look === k} onClick={() => setLook(k)}>{l}</button>)}</div></div>
      <div className="field">배경 움직임<div className="seg"><button type="button" className={motion ? 'on' : ''} aria-pressed={motion} onClick={() => setMotion(true)}>켜기</button><button type="button" className={motion ? '' : 'on'} aria-pressed={!motion} onClick={() => setMotion(false)}>끄기</button></div></div>
      <div className="field">글자 크기<div className="seg"><button type="button" onClick={() => changeFs(-1)}>가 −</button><button type="button" style={{ color: 'var(--ink)' }} aria-label={`글자 크기 ${fs}`}>{fs}</button><button type="button" onClick={() => changeFs(1)}>가 +</button></div></div>
      <div className="note">‘자동’은 라이트 모드에서 소설 분위기(꽃잎·반딧불·빗줄기), 다크 모드에서 차분한 기본 배경이에요. 움직임이 신경 쓰이면 ‘배경 움직임 끄기’를 누르세요.</div>
    </Sheet>
  )
}
