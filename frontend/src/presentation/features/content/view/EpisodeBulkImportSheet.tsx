import { useRef, useState, type ReactNode } from 'react'
import { Go } from '../../../shared/Go'
import { Sheet } from '../../../shared/Sheet'
import { paginate } from '../../../shared/paginate'
import { useEpisodeBulkImport } from '../viewmodel/useEpisodeBulkImport'
import './episode-bulk-import.css'

const STATUS = { created: '새 회차 저장', versioned: '새 버전 저장', failed: '실패' } as const

function FilePicker({ children, onSelect, multiple = false, disabled = false, label }: {
  children: ReactNode
  onSelect: (files: FileList) => void
  multiple?: boolean
  disabled?: boolean
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={input} type="file" accept=".txt,.epub" multiple={multiple} hidden disabled={disabled}
        onChange={(event) => {
          const { files } = event.currentTarget
          if (files?.length) onSelect(files)
          event.currentTarget.value = ''
        }} />
      <button type="button" className="btn" aria-label={label}
        disabled={disabled} onClick={() => input.current?.click()}>{children}</button>
    </>
  )
}

export function EpisodeBulkImportSheet({ workId, onClose }: {
  workId: string
  onClose: (refresh: boolean) => void
}) {
  const vm = useEpisodeBulkImport(workId)
  const [page, setPage] = useState(1)
  const heading = useRef<HTMLHeadingElement>(null)
  const visible = paginate(vm.rows, page)
  const close = () => { if (!vm.busy) onClose(vm.savedCount > 0 || vm.stopReason !== null) }

  function select(files: FileList) {
    if (vm.selectFiles(files)) setPage(1)
  }

  return (
    <Sheet sid="U24" label="회차 파일 일괄 업로드" panelClass="sheet episode-bulk-import" onClose={close}>
      <header className="episode-bulk-header">
        <h2 ref={heading} tabIndex={-1} data-autofocus>회차 파일 일괄 업로드</h2>
        <p className="muted small">TXT·EPUB 파일 하나를 한 회차로 저장해요. 최대 1,000개를 선택할 수 있어요.</p>
      </header>
      <div className="episode-bulk-body">
        {!vm.progress && <div className="episode-bulk-drop"
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = vm.editable ? 'copy' : 'none'
          }}
          onDrop={(event) => { event.preventDefault(); select(event.dataTransfer.files) }}>
          <FilePicker multiple disabled={!vm.editable} onSelect={select}>
            {vm.rows.length > 0 ? '파일 다시 선택' : '파일 선택'}
          </FilePicker>
          <span className="muted small">또는 파일을 이곳에 놓아 주세요.</span>
        </div>}
        {!vm.progress && <label className="episode-bulk-start">
          시작 회차
          <input className="inp" type="number" min={1} max={vm.basis ? vm.basis.lastNumber + 1 : undefined}
            value={vm.start} disabled={!vm.editable || !vm.basis}
            onChange={(event) => vm.setStart(event.currentTarget.value)} />
        </label>}
        {vm.basis && vm.rows.length > 0 && vm.rows[0].number === 0 &&
          <p role="alert">시작 회차를 확인해 주세요. 새 회차는 {vm.basis.lastNumber + 1}화부터 등록할 수 있어요.</p>}
        {!vm.basis && !vm.error && <p role="status">회차 정보를 불러오고 있어요.</p>}
        {visible.items.length > 0 && (
          <>
            <p className="muted small">{vm.rows.length.toLocaleString()}개 · {(vm.rows.reduce((bytes, row) => bytes + row.file.size, 0) / 1_048_576).toFixed(2)} MiB</p>
            <ol aria-label="파일별 대상 회차와 저장 결과" className="episode-bulk-rows">
              {visible.items.map((row, offset) => {
                const isLast = row === vm.rows.at(-1)
                const result = vm.results.get(row.number)
                const existing = row.number > 0 && !!vm.basis && row.number <= vm.basis.lastNumber
                return (
                  <li key={row.id}>
                    <div className="episode-bulk-row-heading">
                      <strong>{row.number > 0 ? `${row.number}화` : '회차 번호 확인'}</strong>
                      {result ? <span className="chip" data-result={result.status}>{STATUS[result.status]}</span> :
                        existing && <span className="chip">기존 회차에 새 버전 저장</span>}
                    </div>
                    <p>{row.file.name}</p>
                    {row.title && result?.status === 'failed' &&
                      <p className="muted small">저장 제목 · {row.title}</p>}
                    {result?.reason && <p className="episode-bulk-error small">{result.reason}</p>}
                    {vm.editable && (
                      <div className="episode-bulk-actions">
                        <button type="button" className="btn sm" disabled={visible.page === 1 && offset === 0}
                          aria-label={`${row.file.name} 위로 이동`}
                          onClick={() => {
                            vm.move(row.id, -1)
                            if (offset === 0) setPage(visible.page - 1)
                          }}>위로</button>
                        <button type="button" className="btn sm" disabled={isLast}
                          aria-label={`${row.file.name} 아래로 이동`}
                          onClick={() => {
                            vm.move(row.id, 1)
                            if (offset === visible.items.length - 1 && !isLast) {
                              setPage(visible.page + 1)
                            }
                          }}>아래로</button>
                      </div>
                    )}
                    {vm.canRetry && result?.status === 'failed' && (
                      <div className="episode-bulk-actions">
                        <FilePicker label={`${row.number}화 파일 교체`}
                          onSelect={(files) => vm.replaceFailed(row.number, files[0])}>파일 교체</FilePicker>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
            {visible.pages > 1 && (
              <nav aria-label="파일 목록 페이지" className="episode-bulk-actions">
                <button type="button" className="btn sm" disabled={visible.page === 1}
                  onClick={() => setPage(visible.page - 1)}>이전</button>
                <span>{visible.page} / {visible.pages}</span>
                <button type="button" className="btn sm" disabled={visible.page === visible.pages}
                  onClick={() => setPage(visible.page + 1)}>다음</button>
              </nav>
            )}
          </>
        )}

      </div>

      <footer className="episode-bulk-footer">
        {vm.error && <p className="episode-bulk-error small" role="alert">{vm.error}</p>}
        {vm.stopReason && <p className="episode-bulk-error small" role="alert">{vm.stopReason} 저장본을 확인한 뒤 다시 시작해 주세요.</p>}
        {vm.progress && (
          <div className="episode-bulk-progress" role="status">
            <progress aria-label="이번 전송의 파일 처리 진행률" value={vm.progress.done} max={vm.progress.total} />
            <p className="small">이번 전송 {vm.progress.done}/{vm.progress.total}개 처리 · 저장 {vm.savedCount}개 · 실패 {vm.failedCount}개</p>
          </div>
        )}
        {/* 회차 탭은 공개 회차만 보이므로 저장한 초안을 어디서 보는지 알린다. */}
        {!vm.busy && vm.savedCount > 0 && <p className="muted small">
          저장한 회차는 비공개 초안이에요. <Go to={`/studio/${workId}`}>집필실</Go>에서 확인하고 발행해 주세요.
        </p>}
        {(vm.editable || vm.canRetry) && <label className="episode-bulk-rights">
          <input type="checkbox" checked={vm.rightsConfirmed}
            onChange={(event) => vm.setRightsConfirmed(event.currentTarget.checked)} />
          원고 등록 권한이 있고 계약상 등록·이용 제한이 없음을 확인했어요.
        </label>}
        <div className="episode-bulk-actions">
          <button type="button" className="btn" disabled={vm.busy} onClick={close}>닫기</button>
          {!vm.basis && vm.error && <button type="button" className="btn" onClick={vm.refreshBasis}>회차 정보 다시 읽기</button>}
          {vm.editable && <button type="button" className="btn pri" disabled={!vm.canStart}
            onClick={() => { heading.current?.focus(); void vm.submit() }}>회차 저장</button>}
          {vm.failedCount > 0 && <button type="button" className="btn pri" disabled={!vm.canRetry || !vm.rightsConfirmed}
            onClick={() => { heading.current?.focus(); void vm.retryFailed() }}>실패한 {vm.failedCount}개 재시도</button>}
        </div>
      </footer>
    </Sheet>
  )
}
