import { expect, it } from 'vitest'

import type { WorldRevisionSummary } from '../../../../domain/entities/studioWorld'
import { worldVersionRows } from './worldVersionGraph'

const revision = (revisionNo: number, name: string): WorldRevisionSummary => ({ worldId: 'w', revisionId: `r${revisionNo}`, revisionNo, name, createdAt: `2026-11-0${revisionNo}T00:00:00Z` })

it('draws the working draft first and then the confirmed versions newest first, marking the one the draft is based on', () => {
  const rows = worldVersionRows([revision(1, '초판'), revision(3, '셋째'), revision(2, '개정')], false, 'r3')
  expect(rows.map((r) => [r.kind, r.id, r.label, r.head, r.unsaved])).toEqual([
    ['draft', 'draft', '작업 초안', true, false],
    ['version', 'r3', '확정 버전 3 · 셋째 · 현재 기준', false, false],
    ['version', 'r2', '확정 버전 2 · 개정', false, false],
    ['version', 'r1', '확정 버전 1 · 초판', false, false],
  ])
  expect(rows[1].savedAt).toBe('2026-11-03T00:00:00Z')
})

it('shows only the draft when nothing is confirmed, and flags unsaved edits on it', () => {
  expect(worldVersionRows([], true, null)).toEqual([{ kind: 'draft', id: 'draft', label: '작업 초안', head: true, unsaved: true, published: false }])
})
