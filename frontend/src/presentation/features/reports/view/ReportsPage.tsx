import type { FormEvent } from 'react'

import { reportKindLabel, reportStatusLabel } from '../../../../domain/entities/report'
import { kstDateTime } from '../../../shared/format'
import { ReportHistoryList } from '../../../shared/reports/ReportHistoryList'
import { Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useReportsViewModel } from '../viewmodel/useReportsViewModel'

/** 내 신고 목록·상세(이력)와 신고자 증거 보완·작품 소유자 소명 */
export function ReportsPage() {
  useDocumentTitle('내 신고')
  const vm = useReportsViewModel()
  const { list, detail, report: r } = vm
  const rows = list.data ?? []
  const evidenceRequests = (r?.history ?? []).filter((h) => h.type === 'EVIDENCE_REQUEST')
  const submitBody = (save: (id: string, body: string) => Promise<boolean>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    if (r && await save(r.id, String(new FormData(form).get('body') ?? ''))) form.reset()
  }
  return (
    <>
      <Gnb />
      <main id='main' tabIndex={-1} className='wrap'>
        <div className='topbar' style={{ height: 'auto', marginBottom: 14 }}>
          <h1 style={{ fontSize: 22 }}>내 신고</h1>
          <button type='button' className='btn sm' disabled={list.isRefreshing} onClick={list.retry}>새로고침</button>
        </div>
        <section className='panel' aria-label='신고 목록'>
          <p className='small muted'>내가 접수한 신고와 내 작품이 대상인 신고를 최신순으로 보여 줘요.</p>
          {list.isLoading && <p role='status'>신고 목록을 불러오고 있어요.</p>}
          {list.isError && (
            <div role='alert'>
              <p>신고 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
              <button type='button' className='btn sm' onClick={list.retry}>다시 불러오기</button>
            </div>
          )}
          {list.data && (rows.length
            ? (
              <ul className='mt-3 list-none p-0'>
                {rows.map((x) => (
                  <li key={x.id}>
                    <button
                      type='button'
                      className={'ibx' + (vm.sel === x.id ? ' on' : '')}
                      aria-pressed={vm.sel === x.id}
                      onClick={() => vm.select(x.id)}
                    >
                      <b>{x.workTitle}</b> <span className='chip'>{reportStatusLabel(x.status)}</span>
                      <br />
                      <span className='small muted'>{[x.workOwnerId === vm.memberId ? '내 작품 대상' : '내가 신고함', reportKindLabel(x.kind), kstDateTime(x.createdAt)].join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
            : <p className='mt-3'>신고 내역이 없어요. 검색 결과 카드나 작품 상세의 ‘소설 신고’ 버튼으로 다른 작가의 공개 작품을 신고할 수 있어요.</p>)}
        </section>
        {vm.sel && (
          <section className='panel' style={{ marginTop: 14 }} aria-label='신고 상세'>
            {detail.isError && (
              <div role='alert'>
                <p>신고 상세를 불러오지 못했어요.</p>
                <button type='button' className='btn sm' onClick={detail.retry}>다시 불러오기</button>
              </div>
            )}
            {!r && !detail.isError && <p role='status'>신고 상세를 불러오고 있어요.</p>}
            {r && (
              <>
                <h2 style={{ fontSize: 18 }}>{r.workTitle}</h2>
                <p className='small muted'>
                  {[vm.isReporter && '내가 신고함', vm.isOwner && '내 작품 대상', reportKindLabel(r.kind), reportStatusLabel(r.status), `작품 ${r.contentRestricted ? '제한 중' : '공개 유지'}`].filter(Boolean).join(' · ')}
                </p>
                <h3 className='mt-4 font-bold'>신고 사유</h3>
                <p className='whitespace-pre-wrap break-words'>{r.reason}</p>
                <h3 className='mt-4 font-bold'>증거</h3>
                <p className='whitespace-pre-wrap break-words'>{r.evidence || '없음'}</p>
                {vm.isOwner && evidenceRequests.length > 0 && (
                  <>
                    <h3 className='mt-4 font-bold'>권리 증빙 요청</h3>
                    <ReportHistoryList history={evidenceRequests} />
                  </>
                )}
                <h3 className='mt-4 font-bold'>처리 이력</h3>
                <ReportHistoryList history={r.history ?? []} />
                {vm.isReporter && (
                  <form className='mt-4 grid gap-2' onSubmit={submitBody(vm.addEvidence)}>
                    <label className='field'>
                      증거 보완<textarea className='ta' name='body' required rows={3} disabled={vm.action.pending} />
                    </label>
                    <div><button type='submit' className='btn sm pri' disabled={vm.action.pending}>증거 보내기</button></div>
                  </form>
                )}
                {vm.isOwner && (
                  <form className='mt-4 grid gap-2' onSubmit={submitBody(vm.addExplanation)}>
                    <label className='field'>
                      소명<textarea className='ta' name='body' required rows={3} disabled={vm.action.pending} />
                    </label>
                    <div><button type='submit' className='btn sm pri' disabled={vm.action.pending}>소명 제출</button></div>
                  </form>
                )}
                {vm.action.pending && <p role='status'>요청을 처리하고 있어요.</p>}
                {vm.action.error && <p role='alert'>{vm.action.error}</p>}
                {vm.action.message && <p role='status'>{vm.action.message}</p>}
              </>
            )}
          </section>
        )}
      </main>
    </>
  )
}
