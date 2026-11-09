import { useState } from 'react'

import { CoverOf } from '../../../shared/art'
import { toast } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { resizeImg } from '../../../shared/resizeImg'
import type { useStudioViewModel } from '../viewmodel/useStudioViewModel'
import { StoryPlanWorkspace } from '../../plans/view/StoryPlanWorkspace'

type VM = ReturnType<typeof useStudioViewModel>

/** 목업 studioViews(id, view) */
export function StudioTools({ id, view, ep }: { id: string; view: string; ep?: number }) {
  return (
    <nav className='svw' aria-label='집필 도구'>
      {([['wiki', '사전'], ['narrative', '플롯'], ['write', '원고'], ['memo', '콘티']] as const)
        .map(([k, l]) => (
          <Go
            key={k}
            to={`/studio/${id}?view=${k}${ep ? `&ep=${ep}` : ''}`}
            className={view === k ? 'on' : ''}
            aria-current={view === k ? 'page' : undefined}
          >
            {l}
          </Go>
        ))}
    </nav>
  )
}

/** 목업 memoView(w): 입력은 화면에 두고 바뀔 때마다 저장합니다. */
export function MemoView({ vm }: { vm: VM }) {
  const [memo, setMemo] = useState(vm.studio!.work.memo ?? '')
  return (
    <section className='memo-page'>
      <h2>콘티</h2>
      <p className='muted'>장면과 대사를 콘티로 정리하세요. 원고에는 자동으로 반영되지 않습니다.</p>
      <div className='snippet-heading'>
        <span />
        <button type='button' className='btn sm' disabled>＋ 새 콘티 · 목업</button>
      </div>
      <div className='snippet-layout'>
        <aside>
          <b>내 콘티</b>
          <div className='snippet-item'>
            콘티 <small>작성 중</small>
          </div>
        </aside>
        <div>
          <label htmlFor='workMemo'>콘티</label>
          <p className='small muted'>장면, 대사, 나중에 쓸 문장을 적어 두세요.</p>
          <textarea
            id='workMemo'
            aria-label='콘티 내용'
            placeholder='콘티를 적어 두세요.'
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value)
              vm.saveNotes({ memo: e.target.value })
            }}
          />
        </div>
      </div>
    </section>
  )
}

/** 비공개 계획은 사전·사건 정본과 분리해 저장합니다. */
export function NarrativeView({ vm }: { vm: VM }) {
  return <StoryPlanWorkspace workId={vm.studio!.work.id} demo />
}

/** 목업 overviewView(w) */
export function OverviewView({ vm }: { vm: VM }) {
  const w = vm.studio!.work
  return (
    <div className='ovw'>
      <p className='note2'>
        데모 표지는 이 브라우저 메모리에서만 바뀌어요.{' '}
        <Go to='/content'>서버 작품의 표지 관리</Go>에서 실제 저장·변경·삭제를 할 수 있어요.
      </p>
      <div className='ovtop'>
        <label className='ovcov'>
          <CoverOf w={w} />
          <span>표지 바꾸기</span>
          <input
            type='file'
            accept='image/*'
            hidden
            onChange={(e) =>
              resizeImg(e.target.files?.[0], async (url) => {
                await vm.saveNotes({ coverImg: url })
                toast('데모 표지 미리보기만 바꿨어요. 서버에는 저장되지 않아요')
              })}
          />
        </label>
        <div>
          <span className='chip'>{w.genre}</span>
          <h2
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            aria-label='한 줄 소개'
            onBlur={(e) => vm.saveNotes({ hook: (e.currentTarget.textContent ?? '').trim() })}
          >
            {w.hook || w.dir || ''}
          </h2>
          <p className='muted small'>한 줄 소개 · 눌러서 고칠 수 있어요</p>
          {w.coverImg
            ? (
              <button
                type='button'
                className='btn sm'
                onClick={async () => {
                  await vm.saveNotes({ coverImg: null })
                  toast('데모 표지 미리보기를 지웠어요. 서버 파일 삭제는 아니에요')
                }}
              >
                표지 이미지 지우기
              </button>
            )
            : (
              <p className='note2'>
                표지 이미지를 올리지 않으면 장르 분위기 그림이 표지로 쓰여요.
              </p>
            )}
        </div>
      </div>
      <h3 className='st'>시놉시스</h3>
      <div
        className='wtext ovsyn'
        contentEditable
        suppressContentEditableWarning
        role='textbox'
        aria-label='시놉시스'
        data-ph='전체 줄거리를 적어 보세요.'
        onBlur={(e) => vm.saveNotes({ synopsis: (e.currentTarget.textContent ?? '').trim() })}
      >
        {w.synopsis || w.summary || ''}
      </div>
    </div>
  )
}
