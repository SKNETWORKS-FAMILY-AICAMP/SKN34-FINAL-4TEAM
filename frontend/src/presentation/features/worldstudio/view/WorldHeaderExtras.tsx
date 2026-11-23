import { useId, useState } from 'react'
import { useHref } from 'react-router'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { downloadText } from '../../../shared/downloadFile'
import { exportFileName, worldToJson, worldToMarkdown } from '../viewmodel/worldExport'
import { RelationContextMenu } from './RelationContextMenu'

/**
 * 독자 시점 미리보기: 연결된 소설의 가장 뒤 발행 회차(`episode`)까지 읽은 독자가 보는 설정 위키(`/work/:id/wiki?upto=N`, 기존 `ReadingUseCase.linkedWorldCards` 경로)를 새 탭으로 연다. 새 화면을 만들지 않는다.
 * 소설 연결이 없거나 발행한 회차가 없으면 이유와 함께 잠긴다. 위키는 확정 버전과 발행 회차 기준이라 저장하지 않은 초안은 보이지 않는다.
 * 안내문(이유)은 보이는 줄이 아니라 버튼의 툴팁(title)과 `aria-describedby`로만 알린다: 줄 전체를 차지해 헤더 버튼이 세로로 쌓이지 않게 한다.
 */
export function ReaderPreviewLink({ workId, episode }: { workId: string | null; episode: number | null }) {
  const href = useHref(workId && episode ? '/work/' + workId + '/wiki?upto=' + episode : '/')
  const note = useId()
  const reason = !workId ? '소설을 연결하면 독자 시점으로 볼 수 있어요.' : episode ? '' : '발행한 회차가 없어요.'
  const why = reason || '확정 버전과 발행 회차 기준이라 저장하지 않은 초안은 보이지 않아요'
  return (
    <>
      {reason
        ? <button type="button" className="btn sm" disabled aria-describedby={note} title={why}>독자 시점으로 보기</button>
        : <a className="btn sm" href={href} target="_blank" rel="noreferrer" aria-describedby={note} title={why}>{episode}화까지 읽은 독자로 보기</a>}
      <span id={note} className="sr-only">{why}</span>
    </>
  )
}

/**
 * 세계관 내보내기: `내보내기 ▸`의 JSON·Markdown은 저장한 세계관(`world`)을 브라우저에서 파일(`세계관이름-YYYYMMDD.json|md`)로 내려받는다.
 * 저장하지 않은 변경(`dirty`)이 있으면 저장된 내용만 내보낸다고 알린다. 다시 가져오기는 하지 않는다.
 */
export function WorldExportButton({ world, dirty }: { world: StudioWorld; dirty: boolean }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const save = (extension: 'json' | 'md') => downloadText(exportFileName(world.name, extension), extension === 'json' ? worldToJson(world) : worldToMarkdown(world), extension === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8')
  return (
    <>
      <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={!!at} onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); setAt(at ? null : { x: box.left, y: box.bottom + 4 }) }}>내보내기 ▸</button>
      {dirty && <span role="status" className="small muted">저장된 내용만 내보내요</span>}
      {at && <RelationContextMenu label="내보내기" x={at.x} y={at.y} entries={[{ label: 'JSON', onSelect: () => save('json') }, { label: 'Markdown', onSelect: () => save('md') }]} onClose={() => setAt(null)} />}
    </>
  )
}
