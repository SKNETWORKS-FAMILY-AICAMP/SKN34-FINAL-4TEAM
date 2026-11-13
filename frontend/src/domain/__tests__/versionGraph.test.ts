import { describe, expect, it } from 'vitest'
import type { Version } from '../entities/content'
import { versionGraphRows } from '../entities/versionGraph'

const version = (n: number): Version => ({ id: `v${n}`, episode: 1, title: `제목${n}`, body: '', revision: n, savedAt: `2026-11-0${n}T00:00:00Z` })
// 서버는 저장 버전을 오래된 것부터 내려 주고, 저장 버전 선택 목록의 '버전 N'도 그 순서의 N번째다.
const episode = { versions: [version(1), version(2), version(3)], publishedVersionId: null as string | null, inherited: false, hasDraft: true as boolean | undefined }

describe('버전 그래프 행', () => {
  it('작업 초안을 맨 위 현재 위치로 두고 저장 버전을 최신부터 선택 목록과 같은 번호로 잇는다', () => {
    const rows = versionGraphRows(episode, false)
    expect(rows.map(r => [r.kind, r.id, r.label])).toEqual([
      ['draft', 'draft', '작업 초안'],
      ['version', 'v3', '버전 3 · 제목3'],
      ['version', 'v2', '버전 2 · 제목2'],
      ['version', 'v1', '버전 1 · 제목1'],
    ])
    expect(rows.map(r => r.head)).toEqual([true, false, false, false])
    expect(rows[1].savedAt).toBe('2026-11-03T00:00:00Z')
  })

  it('저장 버전이 없으면 작업 초안만 그린다', () => {
    expect(versionGraphRows({ ...episode, versions: [] }, false).map(r => r.kind)).toEqual(['draft'])
  })

  it('저장하지 않은 변경은 작업 초안에만 표시한다', () => {
    const rows = versionGraphRows(episode, true)
    expect(rows.map(r => r.unsaved)).toEqual([true, false, false, false])
    expect(versionGraphRows(episode, false).some(r => r.unsaved)).toBe(false)
  })

  it('발행본 배지는 발행 중인 저장 버전에만 붙인다', () => {
    const rows = versionGraphRows({ ...episode, publishedVersionId: 'v2' }, false)
    expect(rows.filter(r => r.published).map(r => r.id)).toEqual(['v2'])
    expect(versionGraphRows(episode, false).some(r => r.published)).toBe(false)
  })

  it('복원은 별도 분기 없이 새 저장 버전이 맨 앞에 쌓인 모습이다', () => {
    const restored = { ...episode, versions: [...episode.versions, { ...version(1), id: 'v4', title: '제목1' }], publishedVersionId: 'v3' }
    const rows = versionGraphRows(restored, false)
    expect(rows.map(r => r.id)).toEqual(['draft', 'v4', 'v3', 'v2', 'v1'])
    expect(rows[1].label).toBe('버전 4 · 제목1')
    expect(rows.filter(r => r.published).map(r => r.id)).toEqual(['v3'])
  })

  it('초안을 삭제한 회차는 초안 노드를 빼고, 삭제한 뒤 새로 입력하면 다시 그린다', () => {
    expect(versionGraphRows({ ...episode, hasDraft: false }, false).map(r => r.kind)).toEqual(['version', 'version', 'version'])
    expect(versionGraphRows({ ...episode, hasDraft: false }, false).some(r => r.head)).toBe(false)
    expect(versionGraphRows({ ...episode, hasDraft: false }, true).map(r => r.kind)).toEqual(['draft', 'version', 'version', 'version'])
  })

  it('hasDraft를 모르는 응답은 초안이 있는 것으로 본다', () => {
    expect(versionGraphRows({ ...episode, hasDraft: undefined }, false)[0].kind).toBe('draft')
  })

  it('원작 기준 회차는 작업 초안 없이 기준 노드가 현재 위치다', () => {
    const rows = versionGraphRows({ versions: [], publishedVersionId: 'source', inherited: true, hasDraft: true }, false)
    expect(rows).toEqual([{ kind: 'base', id: 'base', label: '원작 기준', head: true, unsaved: false, published: false }])
    // 읽기 전용이라 입력 상태가 남아 있어도 저장 안 됨을 만들지 않는다.
    expect(versionGraphRows({ versions: [], publishedVersionId: 'source', inherited: true, hasDraft: true }, true).some(r => r.unsaved)).toBe(false)
  })
})
