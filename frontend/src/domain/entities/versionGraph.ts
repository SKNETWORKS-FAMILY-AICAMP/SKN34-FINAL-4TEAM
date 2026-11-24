import type { Draft, WritingEpisode } from './content'

/** 집필실 버전 그래프의 한 줄. 위가 최신이고 표시 형식(시각·배지 문구)은 화면이 정한다. */
export type VersionGraphRow = {
  kind: 'draft' | 'version' | 'base'
  /** draft·base는 고정 값, version은 저장 버전 id */
  id: string
  label: string
  /** 저장 버전의 저장 시각(ISO) */
  savedAt?: string
  /** 편집기가 지금 보여 주는 위치: 편집기 내용이 저장 버전과 같으면 그 버전(같은 내용이 여럿이면 가장 최신), 아니면 작업 초안, 원작 기준 회차는 기준 노드 */
  head: boolean
  /** 작업 초안에 저장하지 않은 변경이 있다 */
  unsaved: boolean
  /** 독자에게 공개 중인 저장 버전 */
  published: boolean
}

/**
 * 선택 회차의 작업 초안·저장 버전·원작 기준을 위에서 아래(최신 → 과거)로 잇는다.
 * `versions`는 서버가 오래된 것부터 주며 '버전 N'은 저장 버전 선택 목록과 같은 순서의 N번째다.
 * 복원은 새 저장 버전으로 쌓이므로 분기를 따로 그리지 않는다.
 */
export function versionGraphRows(
  episode: Pick<WritingEpisode, 'versions' | 'publishedVersionId' | 'inherited' | 'hasDraft'>,
  dirty: boolean,
  /** 편집기가 지금 보여 주는 내용. 주면 현재 위치를 내용이 같은 저장 버전으로 옮기고, 주지 않으면 작업 초안이다. */
  current?: Pick<Draft, 'title' | 'body' | 'authorNote'>,
): VersionGraphRow[] {
  const { inherited } = episode
  // 초안을 지운 회차도 지운 뒤 새로 입력하면(dirty) 작업 초안이 다시 생긴다.
  const draft = !inherited && (episode.hasDraft !== false || dirty)
  // 편집기 내용(제목·본문·작가의 말)이 저장 버전과 같으면 현재 위치는 그 버전이다(같은 내용이 여럿이면 가장 최신). 한 글자라도 다르면 작업 초안이다.
  const at = !inherited && current
    ? episode.versions.findLastIndex(v => v.title === current.title && v.body === current.body && (v.authorNote ?? '') === (current.authorNote ?? ''))
    : -1
  const saved = episode.versions.map((v, i): VersionGraphRow => ({
    kind: 'version', id: v.id, label: `버전 ${i + 1} · ${v.title}`, savedAt: v.savedAt,
    head: i === at, unsaved: false, published: v.id === episode.publishedVersionId,
  })).reverse()
  return [
    ...(draft ? [{ kind: 'draft', id: 'draft', label: '작업 초안', head: at < 0, unsaved: dirty, published: false } as const] : []),
    ...saved,
    ...(inherited ? [{ kind: 'base', id: 'base', label: '원작 기준', head: true, unsaved: false, published: false } as const] : []),
  ]
}
