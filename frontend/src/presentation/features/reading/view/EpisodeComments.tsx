import { useEffect, useRef, useState } from 'react'

import { COMMENT_MAX, COMMENT_SORTS, type EpisodeComment } from '../../../../domain/entities/episodeComment'
import type { Sentence } from '../../../../domain/entities/feedback'
import { avatarOf } from '../../../../domain/entities/work'
import { Go } from '../../../shared/Go'
import { useEpisodeCommentsViewModel } from '../viewmodel/useEpisodeCommentsViewModel'
import { CommentSheet } from './Sheets'

type Vm = ReturnType<typeof useEpisodeCommentsViewModel>

/** ref 콜백이 매 렌더 다시 불리지 않도록 모듈 함수로 둡니다(수정 입력이 나타날 때만 포커스). */
const focusNow = (el: HTMLTextAreaElement | null) => el?.focus()

const SpoilerCheck = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) => (
  <label className="ck"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> 스포일러 표시</label>
)

function CommentRow({ c, vm }: { c: EpisodeComment; vm: Vm }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  // 수정을 마치면(저장·취소) 사라진 입력 대신 수정 버튼으로 포커스를 돌려 키보드 위치를 잃지 않게 합니다.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing])
  const body = <div className="cbody">{c.body}</div>
  return (
    <div className="cm">
      <i className="av" style={{ background: avatarOf(c.authorName) }} />
      <div>
        <b>{c.authorName}{c.edited && <small> · 수정됨</small>}</b>
        {c.quote && <q className="cq">{c.quote}</q>}
        {editing ? (
          <form onSubmit={(ev) => { ev.preventDefault(); void vm.update(c, text, spoiler).then((ok) => { if (ok) setEditing(false) }) }}>
            <textarea ref={focusNow} className="ta" aria-label="댓글 수정" maxLength={COMMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
            <SpoilerCheck checked={spoiler} onChange={setSpoiler} />
            <div className="cact">
              <button type="submit" className="btn sm pri" disabled={vm.busy}>저장</button>
              <button type="button" className="btn sm" onClick={() => setEditing(false)}>취소</button>
            </div>
          </form>
        ) : (
          <>
            {c.spoiler ? <details><summary>스포일러 댓글 보기</summary>{body}</details> : body}
            {c.mine && (
              <div className="cact">
                <button ref={editButton} type="button" className="lk" onClick={() => { setText(c.body); setSpoiler(c.spoiler); setEditing(true) }}>수정</button>
                <button type="button" className="lk" disabled={vm.busy} onClick={() => void vm.remove(c)}>삭제</button>
              </div>
            )}
          </>
        )}
      </div>
      {vm.loggedIn
        ? <button type="button" className={`lk${c.liked ? ' on' : ''}`} aria-pressed={c.liked} aria-label={`좋아요 ${c.likeCount}개`} disabled={vm.busy} onClick={() => void vm.toggleLike(c)}>{c.liked ? '♥' : '♡'} {c.likeCount}</button>
        : <Go to="/login" className="lk" aria-label={`좋아요 ${c.likeCount}개, 로그인이 필요해요`} onClick={vm.requireLogin}>♡ {c.likeCount}</Go>}
    </div>
  )
}

/**
 * 실제 작품(Content) 회차의 댓글 영역(기능 22). 목록·작성·수정·삭제·좋아요는 서버 API이고, quoted가 있으면 그 문장을 인용하는 댓글 시트를 함께 엽니다.
 * 회차가 바뀌면 호출 측이 key로 새로 만들어 입력과 요청 상태를 비웁니다.
 */
export function EpisodeComments({ workId, n, quoted, onCloseSheet }: { workId: string; n: number; quoted?: Sentence; onCloseSheet: () => void }) {
  const vm = useEpisodeCommentsViewModel(workId, n)
  const [text, setText] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const { comments } = vm
  return (
    <>
      <section className="tcard cms">
        <h3>{comments ? `댓글 ${comments.length}` : '댓글'}</h3>
        <div className="sortt" role="group" aria-label="댓글 정렬">
          {COMMENT_SORTS.map(([k, label]) => <button key={k} type="button" className={vm.sort === k ? 'on' : ''} aria-pressed={vm.sort === k} onClick={() => vm.setSort(k)}>{label}</button>)}
        </div>
        {vm.loggedIn ? (
          <form onSubmit={(ev) => { ev.preventDefault(); void vm.create(text, null, spoiler).then((ok) => { if (ok) { setText(''); setSpoiler(false) } }) }}>
            <div className="cmf">
              <input aria-label="댓글 입력" placeholder="감상이나 궁금한 점을 남겨 주세요" maxLength={COMMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
              <button className="tbtn pri" style={{ height: 44 }} disabled={vm.busy}>등록</button>
            </div>
            <SpoilerCheck checked={spoiler} onChange={setSpoiler} />
          </form>
        ) : (
          <Go to="/login" className="tbtn pri" onClick={vm.requireLogin}>로그인하고 댓글 남기기</Go>
        )}
        {vm.isError && (
          <div role="alert">
            <p className="muted">댓글을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
          </div>
        )}
        {!comments && !vm.isError && <p className="muted" role="status">댓글을 불러오고 있어요…</p>}
        {comments?.length === 0 && <p className="muted">아직 댓글이 없어요. 첫 댓글을 남겨 보세요.</p>}
        {comments?.map((c) => <CommentRow key={c.id} c={c} vm={vm} />)}
      </section>
      {quoted && <CommentSheet workId={workId} n={n} sentence={quoted} maxLength={COMMENT_MAX} submit={(body, sentence, isSpoiler) => vm.create(body, sentence.t, isSpoiler)} onClose={onCloseSheet} />}
    </>
  )
}
