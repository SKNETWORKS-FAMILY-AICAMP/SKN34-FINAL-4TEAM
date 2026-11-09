import { REPORT_KINDS, type ReportKind } from '../../../domain/entities/report'
import { Go } from '../Go'
import { useReportWorkViewModel } from './useReportWorkViewModel'

/** 공개 작품 상세의 신고 버튼과 접수 폼(34). 작품이 바뀌면 호출 측이 key로 새로 만듭니다. */
export function ReportWorkForm({ workId, workTitle }: { workId: string; workTitle: string }) {
  const vm = useReportWorkViewModel(workId)
  return (
    <div className='mt-3'>
      <button type='button' className='btn sm' aria-expanded={vm.open} onClick={vm.toggle}>{vm.open ? '신고 닫기' : '신고'}</button>
      {vm.open && (
        <form
          className='mt-3 grid gap-3'
          aria-label={`${workTitle} 신고`}
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const data = new FormData(form)
            const kind: ReportKind = data.get('kind') === 'HARMFUL' ? 'HARMFUL' : 'RIGHTS'
            if (await vm.submit(kind, String(data.get('reason') ?? ''), String(data.get('evidence') ?? ''))) form.reset()
          }}
        >
          <fieldset disabled={vm.pending} className='m-0 grid min-w-0 gap-3 border-0 p-0'>
            <label className='field'>
              신고 종류<select className='inp' name='kind' defaultValue='RIGHTS'>
                {REPORT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className='field'>
              신고 사유<textarea className='ta' name='reason' required maxLength={2000} rows={3} />
            </label>
            <label className='field'>
              증거 (선택)<textarea className='ta' name='evidence' maxLength={5000} rows={3} placeholder='원작 링크, 문제 회차·문장 등' />
            </label>
            <div>
              <button type='submit' className='btn pri sm'>{vm.pending ? '접수 중…' : '신고 접수'}</button>
            </div>
          </fieldset>
          {vm.pending && <p role='status'>신고를 보내고 있어요.</p>}
          {vm.error && <p role='alert'>{vm.error}</p>}
          {vm.done && <p role='status'>신고를 접수했어요. <Go to='/reports'>내 신고</Go>에서 진행 상황을 확인할 수 있어요.</p>}
        </form>
      )}
    </div>
  )
}
