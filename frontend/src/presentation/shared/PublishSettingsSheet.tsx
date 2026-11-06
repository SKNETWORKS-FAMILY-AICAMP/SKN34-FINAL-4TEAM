import { useState } from 'react'

import type { Work } from '../../domain/entities/work'
import type { PublishSettings } from '../../domain/usecases/StudioUseCase'
import { Sheet } from './Sheet'

/** 목업 publishSheet(id): U21 소설 공개 설정. 집필실과 서재 양쪽에서 엽니다. */
export function PublishSettingsSheet(
  { work: w, onSave, onClose }: {
    work: Work
    onSave: (st: PublishSettings) => Promise<boolean>
    onClose: () => void
  },
) {
  const [st, setSt] = useState<PublishSettings>({
    vis: w.private ? '나만' : '모두',
    on: !!w.forksAllowed,
    all: !!w.forkAll,
    eps: w.forkEps ?? [],
    kind: w.kind,
    ok: w.rights === '확인됨',
  })
  const set = (patch: Partial<PublishSettings>) => setSt({ ...st, ...patch })
  const mode = !st.on ? 'off' : st.all ? 'all' : 'eps'
  const all = w.eps.map((_, i) => i + 1)
  return (
    <Sheet sid='U21' label={`공개 설정 · ${w.title}`} onClose={onClose}>
      <div className='sh-h'>
        <h3>공개 설정 · {w.title}</h3>
        <button type='button' className='x' aria-label='닫기' onClick={onClose}>✕</button>
      </div>
      <div className='field'>
        누가 읽을 수 있나요?<div className='seg'>
          {(['나만', '모두'] as const).map((x) => (
            <button
              type='button'
              key={x}
              className={st.vis === x ? 'on' : ''}
              aria-pressed={st.vis === x}
              onClick={() => set({ vis: x })}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className='field'>
        다른 사람의 포크<div className='seg'>
          {([['off', '허용 안 함'], ['eps', '회차별 선택'], ['all', '전체 회차 허용']] as const)
            .map(([m, l]) => (
              <button
                type='button'
                key={m}
                className={mode === m ? 'on' : ''}
                aria-pressed={mode === m}
                onClick={() =>
                  set({
                    on: m !== 'off',
                    all: m === 'all',
                    eps: m === 'eps' && !st.eps.length ? all : st.eps,
                  })}
              >
                {l}
              </button>
            ))}
        </div>
      </div>
      {st.on && !st.all && (
        <div className='fkeps' id='fkeps'>
          {w.eps.length
            ? w.eps.map((e, i) => (
              <label className='fke' key={i}>
                <input
                  type='checkbox'
                  checked={st.eps.includes(i + 1)}
                  onChange={(x) =>
                    set({
                      eps: x.target.checked
                        ? [...st.eps, i + 1]
                        : st.eps.filter((n) => n !== i + 1),
                    })}
                />
                <span>
                  <b>{i + 1}화</b> {e.t}
                </span>
                <small>{st.eps.includes(i + 1) ? '포크 허용' : '허용 안 함'}</small>
              </label>
            ))
            : <p className='note2'>아직 공개한 회차가 없어요.</p>}
          <div className='rowend' style={{ justifyContent: 'flex-start', marginTop: 6 }}>
            <button type='button' className='btn sm' onClick={() => set({ eps: all })}>
              모두 선택
            </button>
            <button
              type='button'
              className='btn sm'
              onClick={() => set({ eps: [] })}
            >
              모두 해제
            </button>
          </div>
        </div>
      )}
      {st.on && st.all && (
        <p className='note2' style={{ marginTop: -4 }}>
          지금 있는 회차와 앞으로 공개할 회차 모두 포크할 수 있어요.
        </p>
      )}
      <div className='field'>
        어떤 소설인가요?<div className='seg'>
          {['자체 창작', '다른 사람 소설'].map((x) => (
            <button
              type='button'
              key={x}
              className={st.kind === x ? 'on' : ''}
              aria-pressed={st.kind === x}
              onClick={() => set({ kind: x })}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
        <input
          type='checkbox'
          id='rok'
          checked={st.ok}
          onChange={(e) => set({ ok: e.target.checked })}
        />{' '}
        이 소설을 올리고 AI 처리·포크를 허용할 적법한 권리가 있어요
      </label>
      {st.kind === '다른 사람 소설' && (
        <div className='policy'>
          다른 사람 소설은 신고가 접수되면 운영팀이 공개·포크를 제한할 수 있어요 (관리자 화면 A03).
        </div>
      )}
      <div className='policy'>
        P2 · 미확정 정책 — 유료 열람, 판매 수익 배분은 아직 정해지지 않아 선택할 수 없어요.
      </div>
      <div className='rowend'>
        <button type='button' className='btn' onClick={onClose}>취소</button>
        <button
          type='button'
          className='btn pri'
          id='savepub'
          onClick={async () => {
            if (await onSave(st)) onClose()
          }}
        >
          저장
        </button>
      </div>
    </Sheet>
  )
}
