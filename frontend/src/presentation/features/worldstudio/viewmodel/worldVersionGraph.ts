import type { VersionGraphRow } from '../../../../domain/entities/versionGraph'
import type { WorldRevisionSummary } from '../../../../domain/entities/studioWorld'

/**
 * 세계관 저장 이력을 집필실과 같은 버전 그래프 줄로 만든다: 위가 지금 작업 중인 초안(저장하지 않은 수정이 있으면 표시), 아래로 확정 버전이 최신순이다.
 * 초안이 기대는 확정 버전(`currentRevisionId`)은 이름 뒤에 '현재 기준'을 붙인다. 관계는 버전에 담기지 않아(#132) 그래프에도 그리지 않는다.
 */
export function worldVersionRows(revisions: readonly WorldRevisionSummary[], dirty: boolean, currentRevisionId: string | null | undefined): VersionGraphRow[] {
  const versions = [...revisions].sort((a, b) => b.revisionNo - a.revisionNo).map((r): VersionGraphRow => ({
    kind: 'version', id: r.revisionId, label: `확정 버전 ${r.revisionNo} · ${r.name}${r.revisionId === currentRevisionId ? ' · 현재 기준' : ''}`,
    savedAt: r.createdAt, head: false, unsaved: false, published: false,
  }))
  return [{ kind: 'draft', id: 'draft', label: '작업 초안', head: true, unsaved: dirty, published: false }, ...versions]
}
