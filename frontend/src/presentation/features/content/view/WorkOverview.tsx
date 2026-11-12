import { type RefObject, useEffect, useRef, useState } from 'react'
import { parseHashtags, workKindLabel, type Work, type WorkTaxonomy } from '../../../../domain/entities/content'
import type { MediaTarget } from '../../../../domain/entities/media'
import { AiCoverButton } from '../../../shared/AiCoverButton'
import { Go } from '../../../shared/Go'
import { StoredImage } from '../../../shared/media/MediaPanel'
import { useMediaViewModel } from '../../../shared/media/useMediaViewModel'
import { TaxonomyFields } from './TaxonomyFields'

type Section = 'info' | 'cover' | 'policy'

type Props = {
  work: Work
  /** 요청·표지 전송 중에는 편집을 시작하거나 저장하지 못한다. */
  locked: boolean
  busy: boolean
  /** 지금 작성 중인 회차 번호 */
  nextNo: number
  /** 작품 생성 직후 표지 업로드가 끝나면 올라가, 표지 목록을 다시 읽게 한다. */
  coverRevision: number
  onMediaBusy: (busy: boolean) => void
  /** taxonomy에는 서버 값과 달라진 장르·해시태그만 담긴다(없으면 서버가 유지한다). */
  onSaveInfo: (title: string, summary: string, taxonomy: WorkTaxonomy) => Promise<boolean>
  onSavePolicy: (allowFork: boolean, allowForkPublication: boolean) => Promise<boolean>
  onStopFork: () => Promise<boolean>
  onDeleteFork: () => Promise<boolean>
}

/**
 * 작품 관리 화면 위쪽의 소설 상세형 히어로(표지·제목·장르·유형·공개 상태·소개·해시태그)와 그 아래 카드
 * (원작은 분기 정책, 분기 작품은 포크 정보).
 * 작품 정보(제목·소개·장르·해시태그), 표지, 분기 정책은 영역마다 '편집' 버튼이 하나씩 있고 저장/취소로 바꾼다. 한 번에 한 영역만 편집한다.
 * 저장이 성공해야 읽기 표시로 돌아가며, 실패하면 폼과 입력을 그대로 둔다(오류는 화면 위 알림이 보인다).
 * 작품 유형은 등록 때 정해져 읽기 전용이고, 공개 상태는 회차 공개 흐름이 정하므로 읽기 전용이다.
 * 원고 작성은 이 화면이 아니라 집필실(`/studio/{id}`)에서 하므로 히어로의 '회차 작성하기'가 그리로 보낸다.
 * 작품이 바뀌면 호출 측이 key로 새로 만든다.
 */
export function WorkOverview({ work: w, locked, busy, nextNo, coverRevision, onMediaBusy, onSaveInfo, onSavePolicy, onStopFork, onDeleteFork }: Props) {
  const [editing, setEditing] = useState<Section | null>(null)
  const infoButton = useRef<HTMLButtonElement>(null)
  const coverButton = useRef<HTMLButtonElement>(null)
  const policyButton = useRef<HTMLButtonElement>(null)
  const closed = useRef<Section | null>(null)
  // 저장·취소로 폼이 사라지면 편집을 연 버튼으로 초점을 돌려 키보드 위치를 잃지 않게 한다.
  useEffect(() => {
    const section = closed.current
    if (editing !== null || !section) return
    const button = section === 'info' ? infoButton : section === 'cover' ? coverButton : policyButton
    button.current?.focus()
    closed.current = null
  }, [editing])
  const close = () => {
    closed.current = editing
    setEditing(null)
  }
  const blocked = locked || editing !== null
  const kind = workKindLabel(w)
  return (
    <>
      <section className='whero ep-hero'>
        <OwnCover
          key={`${w.id}-${coverRevision}`}
          workId={w.id}
          editing={editing === 'cover'}
          blocked={blocked}
          disabled={busy}
          editRef={coverButton}
          onBusy={onMediaBusy}
          onEdit={() => setEditing('cover')}
          onClose={close}
        />
        <div className='ep-hero-main'>
          <div className='ep-title-row'>
            <h1 className={editing === 'info' ? 'sr-only' : undefined}>{w.title}</h1>
            {editing !== 'info' && (
              <button ref={infoButton} type='button' className='btn sm' disabled={blocked} onClick={() => setEditing('info')}>
                작품 정보 편집
              </button>
            )}
          </div>
          <div className='ep-chips'>
            {!!w.genres?.length && <span className='g'>{w.genres.join(' · ')}</span>}
            {kind && <span className='chip'>{kind}</span>}
            <span className={'chip ' + (w.visibility === 'public' ? 'ok' : '')}>
              {w.visibility === 'public' ? '공개 중' : '비공개 작품'}
            </span>
          </div>
          {editing === 'info'
            ? <InfoForm key={w.revision} work={w} locked={locked} onSave={onSaveInfo} onClose={close} />
            : w.summary
            ? <p className='sum'>{w.summary}</p>
            : <p className='sum ep-muted'>당신의 이야기를 한 문장씩 채워 보세요.</p>}
          {!!w.hashtags?.length && <div className='hashes'>{w.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
          <div className='stats'>
            <span>공개 회차 <b>{w.episodes.length}</b>화</span>
            {w.hasWritingEpisode !== false && <span>작성 중 <b>{nextNo}</b>화</span>}
          </div>
          <div className='acts'>
            <Go to={`/studio/${w.id}`} className='btn pri'>회차 작성하기</Go>
          </div>
        </div>
      </section>
      {w.source
        ? (
          <section className='tcard ep-card' aria-labelledby='ep-fork-title'>
            <div className='ep-sec-head'>
              <h2 id='ep-fork-title'>포크 정보</h2>
            </div>
            <dl className='ep-facts'>
              <div>
                <dt>원작</dt>
                <dd>{`「${w.source.title}」 ${w.source.episode}화 · 버전 ${w.source.version}에서 분기`}</dd>
              </div>
              {w.source.direction && (
                <div>
                  <dt>분기 방향</dt>
                  <dd>{w.source.direction}</dd>
                </div>
              )}
            </dl>
            {/* 한 줄 동작 영역: 왼쪽 원작으로 가기(보조), 공개 중일 때만 공개 중단, 오른쪽 끝 위험 외곽선 삭제. */}
            <div className='ep-card-actions'>
              {w.source.deleted
                ? <p className='small muted'>삭제된 원작이라 이동할 수 없어요.</p>
                : <Go to={`/work/${w.source.workId}`} className='btn sm'>원작으로 가기</Go>}
              {w.visibility === 'public' && (
                // 공개 중단은 작품을 다시 읽어 revision이 오르고 편집 폼이 새로 시작하므로, 편집 중에는 잠가 저장하지 않은 입력이 사라지지 않게 한다.
                <button type='button' className='btn sm' disabled={blocked} onClick={() => void onStopFork()}>포크 공개 중단</button>
              )}
              <button type='button' className='btn sm ep-danger' disabled={locked} onClick={() => void onDeleteFork()}>포크 삭제</button>
            </div>
          </section>
        )
        : (
          <section className='tcard ep-card' aria-labelledby='ep-policy-title'>
            <div className='ep-sec-head'>
              <h2 id='ep-policy-title'>분기 정책</h2>
              {editing !== 'policy' && (
                <button ref={policyButton} type='button' className='btn sm' disabled={blocked} onClick={() => setEditing('policy')}>
                  분기 정책 편집
                </button>
              )}
            </div>
            {editing === 'policy'
              ? <PolicyForm key={w.revision} work={w} locked={locked} onSave={onSavePolicy} onClose={close} />
              : (
                <dl className='ep-facts'>
                  <div>
                    <dt>분기 만들기</dt>
                    <dd>{w.allowFork ? '허용' : '허용 안 함'}</dd>
                  </div>
                  <div>
                    <dt>분기 작품 최초 공개</dt>
                    <dd>{w.allowForkPublication ? '허용' : '허용 안 함'}</dd>
                  </div>
                </dl>
              )}
          </section>
        )}
    </>
  )
}

/** 같은 값이 같은 순서로 놓인 목록인가. 입력을 서버 값(없으면 빈 목록)과 견주어 바뀐 쪽만 보내는 데 쓴다. */
const sameList = (a: string[], b: string[] = []) => a.length === b.length && a.every((v, i) => v === b[i])

/** 처음 받은 작품 값을 상태로 복사한다. 작품이 다시 읽혀 revision이 바뀌면 호출 측이 key로 새로 만들어 최신 서버 값에서 다시 시작한다. */
function InfoForm({ work, locked, onSave, onClose }: { work: Work; locked: boolean; onSave: Props['onSaveInfo']; onClose: () => void }) {
  const [title, setTitle] = useState(work.title)
  const [summary, setSummary] = useState(work.summary)
  const [genre1, setGenre1] = useState(work.genres?.[0] ?? '')
  const [genre2, setGenre2] = useState(work.genres?.[1] ?? '')
  const [hashtags, setHashtags] = useState((work.hashtags ?? []).map((t) => `#${t}`).join(', '))
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  // 장르·해시태그는 서버 값과 달라진 쪽만 보낸다(생략하면 서버가 유지). 장르가 없던 옛 작품도 제목만 고쳐 저장할 수 있다.
  const genres = [...new Set([genre1, genre2].filter(Boolean))]
  const tags = parseHashtags(hashtags)
  const taxonomy: WorkTaxonomy = { ...(sameList(genres, work.genres) ? {} : { genres }), ...(sameList(tags, work.hashtags) ? {} : { hashtags: tags }) }
  const changed = title.trim() !== work.title || summary.trim() !== work.summary || Object.keys(taxonomy).length > 0
  return (
    <form
      className='ep-edit'
      aria-label='작품 정보 편집'
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSave(title, summary, taxonomy)) onClose()
      }}
    >
      <fieldset disabled={locked}>
        <label>
          작품 제목<input ref={first} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </label>
        <label>
          이야기 소개 <span className='ep-optional'>선택</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} rows={4} />
        </label>
        <TaxonomyFields genre1={genre1} genre2={genre2} hashtags={hashtags} onGenre1={setGenre1} onGenre2={setGenre2} onHashtags={setHashtags} />
        <div className='ep-edit-actions'>
          <button className='btn pri sm' disabled={!changed || !title.trim()}>저장</button>
          <button type='button' className='btn sm' onClick={onClose}>취소</button>
        </div>
      </fieldset>
    </form>
  )
}

function PolicyForm({ work, locked, onSave, onClose }: { work: Work; locked: boolean; onSave: Props['onSavePolicy']; onClose: () => void }) {
  const [allowFork, setAllowFork] = useState(work.allowFork)
  const [allowPublication, setAllowPublication] = useState(work.allowForkPublication)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const changed = allowFork !== work.allowFork || allowPublication !== work.allowForkPublication
  return (
    <form
      className='ep-edit'
      aria-label='분기 정책 편집'
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSave(allowFork, allowPublication)) onClose()
      }}
    >
      <fieldset disabled={locked}>
        <label className='ep-check'>
          <input ref={first} type='checkbox' checked={allowFork} onChange={(e) => setAllowFork(e.target.checked)} /> 분기 만들기 허용
        </label>
        <label className='ep-check'>
          <input type='checkbox' checked={allowPublication} onChange={(e) => setAllowPublication(e.target.checked)} /> 분기 작품 최초 공개 허용
        </label>
        <p className='small muted'>
          생성 허용과 공개 허용은 별개예요. 공개 허용을 철회해도 이미 공개한 분기는 계속 연재할 수 있어요.
        </p>
        <div className='ep-edit-actions'>
          <button className='btn pri sm' disabled={!changed}>저장</button>
          <button type='button' className='btn sm' onClick={onClose}>취소</button>
        </div>
      </fieldset>
    </form>
  )
}

type CoverProps = {
  workId: string
  editing: boolean
  blocked: boolean
  disabled: boolean
  editRef: RefObject<HTMLButtonElement | null>
  onBusy: (busy: boolean) => void
  onEdit: () => void
  onClose: () => void
}

/** 고른 이미지의 미리보기 주소. 파일이 바뀌거나 사라지면(편집을 닫으면) 이전 주소를 해제한다. */
export function usePreviewUrl(file: File | undefined) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file) {
      setUrl('')
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

/**
 * 표지 칸. 평소엔 표지(없으면 기본 표지)만 보이고, 편집에서 고른 이미지는 미리보기로 먼저 보여 주며 '저장'을 눌러야 서버에 올라간다(기존 표지 API 그대로).
 * 현재 표지의 다운로드·삭제는 표지 바로 아래 보조 동작으로 묶고, 저장·취소는 폼 맨 아래 한 줄이다.
 */
function OwnCover({ workId, editing, blocked, disabled, editRef, onBusy, onEdit, onClose }: CoverProps) {
  const target: MediaTarget = { kind: 'cover', workId }
  const media = useMediaViewModel(target)
  const [file, setFile] = useState<File>()
  const preview = usePreviewUrl(file)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    onBusy(media.mutating)
    return () => onBusy(false)
  }, [media.mutating, onBusy])
  useEffect(() => {
    if (editing) first.current?.focus()
  }, [editing])
  const current = media.items[0]
  // 고른 파일은 편집을 닫을 때 버린다. 남겨 두면 다시 연 편집의 비어 있는 입력에서 취소했던 파일이 저장된다.
  const finish = () => {
    setFile(undefined)
    onClose()
  }
  return (
    <div className='ep-hero-cover'>
      <div className='cover ep-cover'>
        {current
          ? <StoredImage target={target} id={current.id} alt='작품 표지' revision={media.revision} />
          : !media.busy && !media.error && <img className='stored-image' src='/default-work-cover.svg' alt='기본 작품 표지' />}
      </div>
      {media.error && <p role='alert' className='small'>{media.error}</p>}
      <p role='status' className='small muted'>{media.busy ? '파일을 처리하고 있어요…' : media.notice}</p>
      {editing
        ? (
          <>
            <form
              className='ep-edit'
              aria-label='표지 편집'
              onSubmit={async (e) => {
                e.preventDefault()
                if (file && await media.upload(file)) finish()
              }}
            >
              <fieldset disabled={media.busy || disabled}>
                {current && (
                  <div className='ep-cover-tools' role='group' aria-label='현재 표지'>
                    <button type='button' className='btn sm' aria-label={`다운로드 · ${current.filename}`} onClick={() => void media.download(current)}>
                      다운로드
                    </button>
                    <button
                      type='button'
                      className='btn sm'
                      aria-label={`삭제 · ${current.filename}`}
                      onClick={() => {
                        if (window.confirm(`${current.filename} 첨부를 삭제할까요?`)) void media.remove(current.id)
                      }}
                    >
                      삭제
                    </button>
                  </div>
                )}
                {/* 브라우저 기본 파일 입력은 시각적으로만 숨기고(키보드·스크린리더 유지) 라벨을 버튼처럼 그린다. 옆의 'AI로 생성'은 아직 연결 전이라 비활성이다. */}
                <div className='ep-cover-pick'>
                  <label className='btn sm ep-file-pick'>
                    이미지 선택
                    <input ref={first} type='file' accept='.png,.jpg,.jpeg' onChange={(e) => setFile(e.target.files?.[0])} />
                  </label>
                  <AiCoverButton />
                </div>
                {file
                  ? (
                    <div className='ep-file-chosen'>
                      {preview && <img src={preview} alt='' />}
                      <span>{`선택한 파일: ${file.name}`}</span>
                    </div>
                  )
                  : <p className='small muted'>PNG·JPEG, 10 MiB 이하. 작품 공개 전에는 나만 볼 수 있어요.</p>}
                <div className='ep-edit-actions'>
                  <button className='btn pri sm' disabled={!file}>저장</button>
                  <button type='button' className='btn sm' onClick={finish}>취소</button>
                </div>
              </fieldset>
            </form>
            {/* ponytail: 취소 안내 문구(공용 useMediaViewModel)가 아직 '첨부 새로고침'을 가리킨다. 공용 훅 문구 정리는 후속. */}
            {media.busy && <button type='button' className='btn sm' onClick={media.cancel}>파일 요청 취소</button>}
          </>
        )
        : (
          <button ref={editRef} type='button' className='btn sm' disabled={blocked} onClick={onEdit}>
            표지 편집
          </button>
        )}
    </div>
  )
}
