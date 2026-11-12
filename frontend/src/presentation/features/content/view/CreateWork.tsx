import { useState } from 'react'
import { parseHashtags, type WorkCreationType, type WorkRegistration } from '../../../../domain/entities/content'
import { AiCoverButton } from '../../../shared/AiCoverButton'
import { TaxonomyFields } from './TaxonomyFields'
import { usePreviewUrl } from './WorkOverview'

type Props = {
  /** 요청 중에는 입력과 전송을 잠근다. */
  busy: boolean
  /** 내 작품 목록을 읽기 전에는 보내지 못한다. */
  ready: boolean
  /** 만들기가 실패한 사유. 누른 버튼 바로 위에 알린다(화면 맨 위 알림은 이 자리에서 보이지 않는다). */
  error?: string
  onCreate: (title: string, summary: string, cover: File | undefined, registration: WorkRegistration) => void
}

/**
 * 새 작품 만들기. 소설 상세 페이지 히어로와 같은 모양(표지 자리 | 제목·소개·유형·장르·해시태그·권리 확인)이고
 * 입력 상태는 이 화면이 열릴 때마다 새로 시작해 이전 작품의 표지 파일이 남지 않는다.
 */
export function CreateWork({ busy, ready, error, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [cover, setCover] = useState<File>()
  const preview = usePreviewUrl(cover)
  const [creationType, setCreationType] = useState<WorkCreationType>('ORIGINAL')
  const [genre1, setGenre1] = useState('')
  const [genre2, setGenre2] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [registerRights, setRegisterRights] = useState(false)
  return (
    <section className='ep-create'>
      <h1>새 작품 만들기</h1>
      <p className='ep-lead'>
        한 문장에서 시작해, 당신만의 세계를 펼쳐 보세요.<br />작품은 비공개로 만들어지고, 준비되면 회차를 공개할 수 있어요.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(title, summary, cover, { creationType, genres: [...new Set([genre1, genre2].filter(Boolean))], hashtags: parseHashtags(hashtags), rightsConfirmed: registerRights })
        }}
      >
        <div className='whero ep-hero'>
          <div className='ep-hero-cover'>
            <div className='cover ep-cover'>
              <img className='stored-image' src={preview || '/default-work-cover.svg'} alt='' />
            </div>
            {/* 작품 관리의 표지 편집과 같이 기본 파일 입력은 시각적으로만 숨기고 라벨을 보조 버튼으로 그린다. */}
            <div className='ep-cover-pick'>
              <label className='btn sm ep-file-pick'>
                표지 이미지 선택<input
                  type='file'
                  accept='.png,.jpg,.jpeg'
                  disabled={busy}
                  onChange={(e) => setCover(e.target.files?.[0])}
                />
              </label>
              <AiCoverButton />
            </div>
            <p className='small muted'>
              {cover
                ? `선택한 파일: ${cover.name}`
                : 'PNG·JPEG · 10 MiB 이하. 작품 생성 후 실제 작품 ID로 표지를 저장해요.'}
            </p>
          </div>
          <div className='ep-hero-main ep-create-fields'>
            <label className='ep-create-title'>
              작품 제목<input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='어떤 이야기를 들려주실 건가요?'
                maxLength={120}
                required
                disabled={busy}
              />
            </label>
            <label>
              이야기 소개 <span className='ep-optional'>선택</span>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder='주인공, 배경, 이야기의 시작을 짧게 적어 주세요.'
                maxLength={2000}
                rows={4}
                disabled={busy}
              />
            </label>
            <fieldset disabled={busy}>
              <legend>작품 유형</legend>
              <label className='ep-check'><input type='radio' name='creationType' checked={creationType === 'ORIGINAL'} onChange={() => setCreationType('ORIGINAL')} /> 원작</label>
              <label className='ep-check'><input type='radio' name='creationType' checked={creationType === 'EXTERNAL_DERIVATIVE'} onChange={() => setCreationType('EXTERNAL_DERIVATIVE')} /> 외부 2차 창작 <span className='ep-optional'>무료 공개만 가능</span></label>
            </fieldset>
            <TaxonomyFields
              genre1={genre1}
              genre2={genre2}
              hashtags={hashtags}
              onGenre1={setGenre1}
              onGenre2={setGenre2}
              onHashtags={setHashtags}
              disabled={busy}
              genreRequired
            />
            <label className='ep-check'>
              <input type='checkbox' checked={registerRights} onChange={(e) => setRegisterRights(e.target.checked)} required disabled={busy} /> 이 작품을 등록할 권리가 있음을 확인합니다.
            </label>
            {error && <div className='ep-alert' role='alert'>{error}</div>}
            <div className='ep-form-footer'>
              <span>◌ 처음에는 나만 볼 수 있어요</span>
              <button className='btn pri' disabled={busy || !ready}>작품 만들기</button>
            </div>
          </div>
        </div>
      </form>
      <div className='ep-steps'>
        <div>
          <b>01</b>
          <strong>쓰고</strong>
          <p>직접 쓰거나 AI와 함께 이어 쓰세요.</p>
        </div>
        <div>
          <b>02</b>
          <strong>공개하고</strong>
          <p>완성한 회차를 독자에게 보여 주세요.</p>
        </div>
        <div>
          <b>03</b>
          <strong>갈라지고</strong>
          <p>다른 선택으로 새로운 이야기를 만드세요.</p>
        </div>
      </div>
    </section>
  )
}
