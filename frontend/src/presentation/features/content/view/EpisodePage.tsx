import { useState } from 'react'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { NOVEL_GENRES } from '../../../../domain/usecases/LibraryUseCase'
import { parseHashtags, publicationActionLabel, workMetaLabel, type WorkCreationType } from '../../../../domain/entities/content'
import { useEpisodeViewModel } from '../viewmodel/useEpisodeViewModel'
import './episode.css'
import { WorldPanel } from './WorldPanel'
import { ContextPreview } from './ContextPreview'
import { ManuscriptBody, MediaPanel, StoredImage } from '../../../shared/media/MediaPanel'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { ReportWorkForm } from '../../../shared/reports/ReportWorkForm'

export function EpisodePage({ useCase }: { useCase?: EpisodeUseCase }) {
  useDocumentTitle('회차 에디터')
  const vm = useEpisodeViewModel(useCase)
  const [tab, setTab] = useState<'write' | 'read' | 'fork' | 'history' | 'world'>('write')
  const [worldVisited, setWorldVisited] = useState(false)
  const [worldDirty, setWorldDirty] = useState(false)
  const [contextAt, setContextAt] = useState(0)
  const [character, setCharacter] = useState('')
  const [publicContext, setPublicContext] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [cover, setCover] = useState<File>()
  const [creationType, setCreationType] = useState<WorkCreationType>('ORIGINAL')
  const [genre1, setGenre1] = useState('')
  const [genre2, setGenre2] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [registerRights, setRegisterRights] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const locked = vm.busy || mediaBusy
  const [prompt, setPrompt] = useState('현재 장면을 자연스럽게 이어 써 주세요.')
  const [consent, setConsent] = useState(false)
  const [rights, setRights] = useState(false)
  const [allowFork, setAllowFork] = useState(false)
  const [allowForkPublication, setAllowForkPublication] = useState(false)
  const [preview, setPreview] = useState(false)
  const [forkTitle, setForkTitle] = useState('')
  const [direction, setDirection] = useState('')
  const [at, setAt] = useState(1)
  const w = vm.active
  const writingNo = w ? (w.writingEpisodeNumber ?? w.episodes.length + 1) : 0
  const pick = (item: typeof w) => {
    if (mediaBusy) return
    if (worldDirty && !window.confirm('저장 중이거나 미저장 설정이 있어요. 이동할까요?')) return
    if (!vm.select(item)) return
    setCover(undefined)
    setWorldVisited(false)
    setWorldDirty(false)
    setContextAt(0)
    setCharacter('')
    setPublicContext(false)
    vm.clearContext()
    setTab(item?.readOnly ? 'read' : 'write')
    setRights(false)
    setRegisterRights(false)
    setAllowFork(item?.allowFork ?? false)
    setAllowForkPublication(item?.allowForkPublication ?? false)
    setPreview(false)
    setAt(1)
  }
  const publish = async () => {
    if (await vm.publish(rights, allowFork, allowForkPublication)) {
      setRights(false)
      setPreview(false)
    }
  }
  const fork = async () => {
    if (await vm.fork(at, forkTitle, direction)) {
      setTab('write')
      setRights(false)
      setAllowFork(false)
      setConsent(false)
      setAllowForkPublication(false)
      setPreview(false)
    }
  }
  return (
    <div className='episode-app'>
      <header className='ep-header'>
        <a href='/lib' className='back'>내 서재</a>
        <button className='ep-brand' onClick={() => pick(null)}>
          STORY<span>FORK</span>
          <small>이야기가 갈라지는 순간</small>
        </button>
        <div className='ep-top-meta'>
          <span className='ep-dot' /> <span className='ep-top-label'>에피소드 스튜디오</span> <span className='chip'>집필 작업실</span>
        </div>
      </header>
      <div className='ep-shell'>
        <aside className='ep-sidebar' aria-label='내 작품'>
          <div className='ep-side-title'>
            내가 쓰는 소설 <span>{vm.works.length}</span>
          </div>
          <button className='btn pri ep-new' disabled={locked} onClick={() => pick(null)}>
            ＋ 새 작품
          </button>
          <a
            className='btn sm'
            href={w && !w.readOnly ? `/studio/${w.id}` : undefined}
            aria-disabled={!w || w.readOnly}
          >
            회차별 집필실 열기
          </a>
          <nav>
            {vm.works.map((item) => (
              <button
                key={item.id}
                className={'ep-work ' + (w?.id === item.id ? 'selected' : '')}
                disabled={locked}
                onClick={() => pick(item)}
              >
                <span className='ep-book'>{item.source ? '⑂' : '▤'}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.source ? '분기 작품' : '원작'} ·{' '}
                    {item.visibility === 'public' ? '공개' : '비공개'} · {item.episodes.length}화
                  </small>
                </span>
              </button>
            ))}
          </nav>
          <button className='btn sm' disabled={locked} onClick={() => void vm.browsePublic()}>
            공개 작품 찾아보기
          </button>
          <nav aria-label='공개 작품'>
            {vm.publicWorks.map((item) => (
              <button
                className='ep-work'
                disabled={locked}
                key={item.id}
                onClick={() => pick(item)}
              >
                {item.title} · 공개 {item.episodes.length}화
              </button>
            ))}
          </nav>
          <div className='ep-side-note'>
            <strong>작가의 선택으로 완성되는 이야기</strong>
            <p>
              AI는 제안을 만들고,<br />적용과 공개는 직접 결정해요.
            </p>
            <p>저장한 원고와 설정은 서버에서 보관해요.</p>
          </div>
        </aside>
        <main className='ep-main' id='main' tabIndex={-1}>
          {vm.error && (
            <div className='ep-alert' role='alert'>
              {vm.error}
              <button className='btn sm' disabled={locked} onClick={vm.reload}>
                최신 데이터 불러오기
              </button>
            </div>
          )}
          <div className='ep-notice' role='status' aria-live='polite'>
            {vm.busy ? '요청을 처리하고 있어요…' : vm.notice}
          </div>
          {!w
            ? (
              <section className='ep-create'>
                <h1>
                  {vm.works.length
                    ? '다음 이야기는 어디에서 시작할까요?'
                    : '첫 이야기를 시작해 보세요'}
                </h1>
                <p className='ep-lead'>
                  한 문장에서 시작해, 당신만의 세계를 펼쳐 보세요.<br />작품은 비공개로 만들어지고,
                  준비되면 회차를 공개할 수 있어요.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void vm.create(title, summary, cover, { creationType, genres: [...new Set([genre1, genre2].filter(Boolean))], hashtags: parseHashtags(hashtags), rightsConfirmed: registerRights })
                  }}
                >
                  <label>
                    작품 제목<input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder='어떤 이야기를 들려주실 건가요?'
                      maxLength={120}
                      required
                      disabled={locked}
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
                      disabled={locked}
                    />
                  </label>
                  <fieldset disabled={locked}>
                    <legend>작품 유형</legend>
                    <label className='ep-check'><input type='radio' name='creationType' checked={creationType === 'ORIGINAL'} onChange={() => setCreationType('ORIGINAL')} /> 원작</label>
                    <label className='ep-check'><input type='radio' name='creationType' checked={creationType === 'EXTERNAL_DERIVATIVE'} onChange={() => setCreationType('EXTERNAL_DERIVATIVE')} /> 외부 2차 창작 <span className='ep-optional'>무료 공개만 가능</span></label>
                  </fieldset>
                  <label>
                    장르<select aria-label='장르' value={genre1} onChange={(e) => setGenre1(e.target.value)} required disabled={locked}>
                      <option value=''>장르를 선택해 주세요</option>
                      {NOVEL_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                  <label>
                    두 번째 장르 <span className='ep-optional'>선택</span><select aria-label='두 번째 장르' value={genre2} onChange={(e) => setGenre2(e.target.value)} disabled={locked}>
                      <option value=''>선택 안 함</option>
                      {NOVEL_GENRES.filter((g) => g !== genre1).map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                  <label>
                    해시태그 <span className='ep-optional'>선택 · 쉼표로 구분 · 10개까지</span><input
                      aria-label='해시태그'
                      value={hashtags}
                      onChange={(e) => setHashtags(e.target.value)}
                      placeholder='#회귀, #성장'
                      disabled={locked}
                    />
                  </label>
                  <label className='ep-check'>
                    <input type='checkbox' checked={registerRights} onChange={(e) => setRegisterRights(e.target.checked)} required disabled={locked} /> 이 작품을 등록할 권리가 있음을 확인합니다.
                  </label>
                  <label>
                    작품 표지 (선택)<input
                      type='file'
                      accept='.png,.jpg,.jpeg'
                      disabled={locked}
                      onChange={(e) => setCover(e.target.files?.[0])}
                    />
                  </label>
                  <p>PNG·JPEG · 10 MiB 이하. 작품 생성 후 실제 작품 ID로 표지를 저장해요.</p>
                  <div className='ep-form-footer'>
                    <span>◌ 처음에는 나만 볼 수 있어요</span>
                    <button className='btn pri' disabled={locked || !vm.ready}>작품 만들기</button>
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
            : (
              <>
                <div className='ep-work-header'>
                  <div>
                    <h1>{w.title}</h1>
                    <p>
                      {w.source
                        ? `「${w.source.title}」 ${w.source.episode}화 · 버전 ${w.source.version}에서 분기`
                        : w.summary || '당신의 이야기를 한 문장씩 채워 보세요.'}
                    </p>
                    {!w.source && workMetaLabel(w) && <p>{workMetaLabel(w)}</p>}
                    {w.readOnly && !vm.activeIsMine && <ReportWorkForm key={w.id} workId={w.id} workTitle={w.title} />}
                  </div>
                  <span className={'chip ' + (w.visibility === 'public' ? 'ok' : '')}>
                    {w.visibility === 'public' ? '공개 중' : '비공개 작품'}
                  </span>
                </div>
                {w.readOnly
                  ? (
                    <StoredImage
                      key={w.id}
                      target={{ kind: 'cover', workId: w.id }}
                      id=''
                      alt='작품 표지'
                      publicView
                    />
                  )
                  : (
                    <MediaPanel
                      key={`${w.id}-${vm.coverRevision}`}
                      target={{ kind: 'cover', workId: w.id }}
                      onBusy={setMediaBusy}
                      disabled={vm.busy}
                    />
                  )}
                <nav className='ep-tabs' aria-label='작품 메뉴'>
                  {([
                    ['write', '원고 작성'],
                    ['read', `공개 원고 · ${w.episodes.length}`],
                    ['world', '세계관·설정집'],
                    ['fork', '이야기 분기'],
                    ['history', '저장·AI·발행 이력'],
                  ] as const).filter(([value]) =>
                    !w.readOnly || value === 'read' || value === 'fork'
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      disabled={locked}
                      aria-current={tab === value ? 'page' : undefined}
                      onClick={() => {
                        setTab(value)
                        if (value === 'world') {
                          setWorldVisited(true)
                          vm.clearContext()
                        }
                        if (value === 'history') void vm.loadHistory()
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {!w.readOnly && worldVisited && (
                  <div hidden={tab !== 'world'}>
                    <WorldPanel
                      key={w.id}
                      workId={w.id}
                      useCase={useCase}
                      onDirty={setWorldDirty}
                    />
                  </div>
                )}
                {!w.readOnly && tab === 'write' && w.hasWritingEpisode === false && (
                  <section className='ep-empty' aria-label='작성 회차 없음'>
                    <p>작성할 회차가 없어요. 집필실에서 회차를 생성한 뒤 작성해 주세요.</p>
                    <a className='btn' href={`/studio/${w.id}`}>집필실에서 회차 생성</a>
                  </section>
                )}
                {!w.readOnly && tab === 'write' && w.hasWritingEpisode !== false && (
                  <div className='ep-writing'>
                    <section className='ep-editor'>
                      <div className='ep-editor-bar'>
                        <span>{writingNo}화 · 새 회차</span>
                        <span>
                          {vm.dirty ? '저장하지 않은 변경' : '서버 저장됨'} · 수정 번호{' '}
                          {vm.draft.revision}
                        </span>
                      </div>
                      <label className='ep-title-label'>
                        <span className='sr-only'>회차 제목</span>
                        <input
                          aria-label='회차 제목'
                          value={vm.draft.title}
                          maxLength={120}
                          onChange={(e) => vm.edit({ title: e.target.value })}
                          disabled={locked}
                        />
                      </label>
                      <label className='ep-body-label'>
                        <span className='sr-only'>원고 본문</span>
                        <textarea
                          aria-label='원고 본문'
                          value={vm.draft.body}
                          onChange={(e) => vm.edit({ body: e.target.value })}
                          placeholder='이야기의 시작을 써 보세요. AI 제안으로 이어갈 수도 있어요.'
                          maxLength={40000}
                          disabled={locked}
                        />
                      </label>
                      <div className='ep-editor-bar'>
                        <span>
                          {Array.from(vm.draft.body).length.toLocaleString()}자 / 40,000자
                        </span>
                        <button className='btn sm' disabled={locked || !vm.dirty} onClick={vm.save}>
                          원고 저장
                        </button>
                      </div>
                      <div className='ep-publish'>
                        <h2>준비된 회차를 공개하세요</h2>
                        <p>
                          현재 회차를 공개 원고로 확정해요. 다음 회차는 새로운 초안에서 시작해요.
                        </p>
                        <label className='ep-check'>
                          <input
                            type='checkbox'
                            checked={rights}
                            onChange={(e) => setRights(e.target.checked)}
                            disabled={locked}
                          />{' '}
                          이 원고를 공개할 권리가 있음을 확인합니다.
                        </label>
                        <label className='ep-check'>
                          <input
                            type='checkbox'
                            checked={allowFork}
                            onChange={(e) => setAllowFork(e.target.checked)}
                            disabled={locked || !!w.source}
                          />{' '}
                          공개된 회차에서 다른 이야기로 분기하는 것을 허용합니다.
                        </label>
                        <label className='ep-check'>
                          <input
                            type='checkbox'
                            checked={allowForkPublication}
                            onChange={(e) => setAllowForkPublication(e.target.checked)}
                            disabled={locked || !!w.source}
                          />{' '}
                          분기 작품의 최초 공개를 허용합니다.
                        </label>
                        {!w.source && (
                          <button
                            className='btn sm'
                            disabled={locked}
                            onClick={() => void vm.policy(allowFork, allowForkPublication)}
                          >
                            분기 허용 설정 저장
                          </button>
                        )}
                        <p>
                          생성 허용과 공개 허용은 별개예요. 공개 허용을 철회해도 이미 공개한 분기는
                          계속 연재할 수 있어요.
                        </p>
                        {vm.selectedVersion && (
                          <p>
                            공개 대상: 저장 버전 {vm.selectedVersion.revision} ·{' '}
                            {vm.selectedVersion.title}
                          </p>
                        )}
                        {!vm.selectedVersion && (
                          <p>저장·AI·발행 이력에서 공개할 저장 버전을 먼저 선택해 주세요.</p>
                        )}
                        <button
                          className='btn pri'
                          disabled={locked || !rights || !vm.selectedVersion?.body.trim()}
                          onClick={() => setPreview(true)}
                        >
                          회차 공개하기
                        </button>
                        {preview && vm.selectedVersion && (
                          <section className='ep-preview' aria-label='공개 미리보기'>
                            <h3>{vm.selectedVersion.title}</h3>
                            <ManuscriptBody
                              workId={w.id}
                              number={vm.selectedVersion.episode}
                              body={vm.selectedVersion.body}
                            />
                            <p>
                              이 원고를 독자에게 공개합니다. 저장·AI·발행 이력에서 다른 저장 버전을
                              선택할 수 있어요.
                            </p>
                            <button
                              className='btn pri'
                              disabled={locked || !rights}
                              onClick={() =>
                                void publish()}
                            >
                              이 원고로 공개 확정
                            </button>
                            <button
                              className='btn sm'
                              disabled={locked}
                              onClick={() =>
                                setPreview(false)}
                            >
                              미리보기 닫기
                            </button>
                          </section>
                        )}
                      </div>
                    </section>
                    <aside className='ep-ai' aria-label='AI 집필 도구'>
                      <span className='ep-ai-icon'>✦</span>
                      <h2>함께 쓰는 다음 문장</h2>
                      <p>
                        원하는 전개나 분위기를 알려 주세요.<br />OpenAI가 이어쓰기 제안을 만들어요.
                      </p>
                      <label>
                        문맥 기준 회차<select
                          value={contextAt}
                          disabled={locked}
                          onChange={(e) => {
                            setContextAt(Number(e.target.value))
                            vm.clearContext()
                          }}
                        >
                          <option value={0}>현재 작성 회차 · {writingNo}화</option>
                          {w.episodes.map((e) => (
                            <option key={e.number} value={e.number}>{e.number}화까지</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        인물 시점 (선택)<input
                          value={character}
                          maxLength={80}
                          placeholder='비우면 작가 시점'
                          disabled={locked}
                          onChange={(e) => {
                            setCharacter(e.target.value)
                            vm.clearContext()
                          }}
                        />
                      </label>
                      <label className='ep-check'>
                        <input
                          type='checkbox'
                          checked={publicContext}
                          disabled={locked}
                          onChange={(e) => {
                            setPublicContext(e.target.checked)
                            vm.clearContext()
                          }}
                        />{' '}
                        독자 공개 문맥만 미리보기
                      </label>
                      <button
                        className='btn sm'
                        disabled={locked || worldDirty}
                        onClick={() =>
                          void vm.loadContext(
                            contextAt || writingNo,
                            prompt,
                            character,
                            publicContext,
                          )}
                      >
                        전송 문맥 확인 (무료)
                      </button>
                      {vm.storyContext && <ContextPreview value={vm.storyContext} />}
                      <label>
                        작가의 말<textarea
                          value={prompt}
                          onChange={(e) => {
                            setPrompt(e.target.value)
                            vm.clearContext()
                          }}
                          maxLength={2000}
                          rows={5}
                          disabled={locked}
                        />
                      </label>
                      <label className='ep-check'>
                        <input
                          type='checkbox'
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          disabled={locked}
                        />
                        <span>
                          조회 기준에 맞는 확정 설정·원고 발췌·현재 초안을 OpenAI에 전송하며 API
                          비용이 발생하는 것에 동의해요.
                        </span>
                      </label>
                      <button
                        className='btn pri'
                        disabled={locked || worldDirty || publicContext || !consent ||
                          !prompt.trim()}
                        onClick={() =>
                          void vm.propose(
                            prompt,
                            consent,
                            contextAt || writingNo,
                            character,
                          )}
                      >
                        ✦ AI 이어쓰기
                      </button>
                      <small>제안은 자동으로 적용되거나 공개되지 않아요.</small>
                      {vm.proposal && (
                        <section className='ep-proposal'>
                          <span className='chip ok'>
                            {vm.proposal.status === 'accepted' ? '적용 완료' : '검토 대기'} ·{' '}
                            {vm.proposal.model}
                          </span>
                          <h3>AI 이어쓰기 제안</h3>
                          <div>{vm.proposal.text}</div>
                          <button
                            className='btn pri sm'
                            disabled={locked || vm.proposal.status !== 'pending' ||
                              vm.proposal.revision !== vm.draft.revision || vm.dirty}
                            onClick={vm.accept}
                          >
                            원고에 적용
                          </button>
                          <button className='btn sm' disabled={locked} onClick={vm.discard}>
                            제안 닫기
                          </button>
                        </section>
                      )}
                    </aside>
                  </div>
                )}
                {!w.readOnly && tab === 'history' && (
                  <section className='ep-reading'>
                    <h2>저장·AI·발행 이력</h2>
                    <p>저장본은 보존돼요. 복원은 새 저장 버전을 만들며 공개본을 바꾸지 않아요.</p>
                    {vm.history && (
                      <>
                        <h3>발행 이력</h3>
                        {!vm.history.publicationHistory?<p role="alert">발행 이력 응답을 확인할 수 없어요.</p>:vm.history.publicationHistory.length?<ol>{vm.history.publicationHistory.map((event,i)=><li key={i}>
                          {event.episode}화 · {publicationActionLabel[event.action]} · {new Date(event.publishedAt).toLocaleString('ko-KR')} · 버전 {event.versionId}
                        </li>)}</ol>:<p>발행 이력이 없어요.</p>}
                        <h3>원고 저장본</h3>
                        {vm.history.versions.length === 0 && (
                          <p>
                            아직 보관된 저장본이 없어요. 원고를 저장하면 버전 이력을 확인할 수
                            있어요.
                          </p>
                        )}
                        {vm.history.versions.map((v) => (
                          <article key={v.id}>
                            <h3>{v.episode}화 · 저장 버전 {v.revision} · {v.title}</h3>
                            <time>{new Date(v.savedAt).toLocaleString('ko-KR')}</time>
                            <ManuscriptBody workId={w.id} number={v.episode} body={v.body} />
                            <button
                              className='btn sm'
                              disabled={locked || w.hasWritingEpisode === false}
                              onClick={async () => {
                                if (await vm.restore(v)) {
                                  setTab('write')
                                  setPreview(false)
                                }
                              }}
                            >
                              이 원고를 새 버전으로 복원
                            </button>
                            {v.episode === writingNo && (
                              <button
                                className='btn sm'
                                disabled={locked}
                                onClick={() => {
                                  vm.chooseVersion(v)
                                  setTab('write')
                                  setPreview(false)
                                }}
                              >
                                이 버전을 공개 대상으로 선택
                              </button>
                            )}
                          </article>
                        ))}
                        <h3>AI 요청·제안</h3>
                        {vm.history.proposals.length === 0 && <p>아직 AI 제안이 없어요.</p>}
                        {vm.history.proposals.map((p) => (
                          <article key={p.id}>
                            <h3>
                              {p.model} · {p.status === 'accepted' ? '적용 완료' : '검토 대기'}
                            </h3>
                            <p>{p.prompt ?? '지시문 기록 없음'}</p>
                            {p.baseBody !== undefined && (
                              <details>
                                <summary>요청 당시 원고</summary>
                                <div>{p.baseBody}</div>
                              </details>
                            )}
                            {p.context && (
                              <details>
                                <summary>요청 당시 설정·문맥 근거</summary>
                                <ContextPreview value={p.context} />
                              </details>
                            )}
                            <div>{p.text}</div>
                            <button
                              className='btn sm'
                              disabled={locked}
                              onClick={() => {
                                vm.openProposal(p)
                                setTab('write')
                              }}
                            >
                              이 제안 다시 열기
                            </button>
                          </article>
                        ))}
                      </>
                    )}
                  </section>
                )}
                {tab === 'read' && (
                  <section className='ep-reading'>
                    <p className='ep-lead'>
                      {w.visibility === 'public'
                        ? '공개된 회차만 표시해요. 작성 중인 초안은 포함되지 않아요.'
                        : '아직 공개 전이에요. 분기 기준 원고는 읽기 전용으로 보관돼요.'}
                    </p>
                    {!w.episodes.length && (
                      <div className='ep-empty'>
                        아직 공개한 회차가 없어요. 첫 회차를 작성해 보세요.
                      </div>
                    )}
                    {w.episodes.map((e) => (
                      <article key={e.number}>
                        <span className='ep-eyebrow'>
                          EPISODE {String(e.number).padStart(2, '0')} · v{e.version}
                          {e.inherited ? ' · 원작 기준 원고' : ''}
                        </span>
                        <h2>{e.title}</h2>
                        <ManuscriptBody
                          workId={w.id}
                          number={e.number}
                          body={e.body}
                          publicView={w.readOnly || w.visibility === 'public'}
                        />
                      </article>
                    ))}
                  </section>
                )}
                {tab === 'fork' && (
                  <section className='ep-fork'>
                    <h2>그 순간, 다른 선택을 했다면</h2>
                    <p className='ep-lead'>
                      선택한 회차까지의 공개 원고를 보존하고,<br />그 다음 회차부터 새로운 이야기를
                      써 내려가세요. 기준 회차의 공개 설정·상태·지식·관계도 함께 이어져요.
                    </p>
                    {w.source || w.visibility !== 'public' || !w.allowFork
                      ? (
                        <div className='ep-empty'>
                          분기를 허용한 공개 원작에서만 시작할 수 있어요. 분기 작품은 다시 분기할 수
                          없어요.<br />회차 공개 시 분기 허용을 선택해 주세요.
                        </div>
                      )
                      : (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            void fork()
                          }}
                        >
                          <label>
                            기준 회차<select
                              value={at}
                              onChange={(e) => setAt(Number(e.target.value))}
                              disabled={locked}
                            >
                              {w.episodes.map((e) => (
                                <option key={e.number} value={e.number}>
                                  {e.number}화 · {e.title} · v{e.version}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            분기 작품 제목<input
                              value={forkTitle}
                              onChange={(e) => setForkTitle(e.target.value)}
                              maxLength={120}
                              required
                              disabled={locked}
                            />
                          </label>
                          <label>
                            무엇이 달라지나요? (선택)<textarea
                              value={direction}
                              onChange={(e) => setDirection(e.target.value)}
                              placeholder='주인공이 그 편지를 읽지 않았다면…'
                              maxLength={2000}
                              rows={4}
                              disabled={locked}
                            />
                          </label>
                          <button className='btn pri' disabled={locked}>
                            이 회차에서 분기 만들기
                          </button>
                        </form>
                      )}
                  </section>
                )}
              </>
            )}
          <footer className='ep-footer'>
            STORYFORK · 저장·적용·공개는 각각 별도로 처리됩니다.
          </footer>
        </main>
      </div>
    </div>
  )
}
