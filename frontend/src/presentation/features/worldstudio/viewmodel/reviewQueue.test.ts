import { expect, it } from 'vitest'

import type { Analysis, Candidate, Decision } from '../../../../domain/entities/initialWorld'
import { reviewGroups } from './reviewQueue'

const candidate = (localRef: string): Candidate => ({ localRef, type: 'fact', title: `후보 ${localRef}`, text: `${localRef} 내용`, subjectId: null, relatedEntityIds: [], provenance: 'ai_extraction', evidence: [], relation: null, condition: '', timeText: '', polarity: 'asserted' })
const analysis = (candidates: Candidate[], decisions: Decision[]): Analysis => ({
  analysisId: 'a', basis: { draftRevision: 1, relationshipVersion: 1, currentRevisionId: null, inputHash: 'h' }, executionStatus: 'completed', freshness: 'current',
  output: { schemaVersion: 'initial-world.v1', candidates, diagnostics: [] }, candidateIds: Object.fromEntries(candidates.map((c) => [c.localRef, `id-${c.localRef}`])), decisions,
})
const decision = (c: Candidate, sequence: number, state: Decision['state']): Decision => ({ candidateId: `id-${c.localRef}`, candidateRef: c.localRef, sequence, state, content: c })

it('groups candidates by their latest decision and keeps held ones in the review queue', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(candidate)
  const groups = reviewGroups(analysis([a, b, c, d, e], [decision(b, 1, 'approved'), decision(c, 1, 'approved'), decision(c, 2, 'rejected'), decision(d, 1, 'held')]))
  expect(groups.pending.map((i) => i.original.localRef)).toEqual(['a', 'd', 'e']) // 결정 없음 + 보류
  expect(groups.approved.map((i) => i.original.localRef)).toEqual(['b'])
  expect(groups.rejected.map((i) => i.original.localRef)).toEqual(['c']) // 가장 큰 순번이 현재 상태다
  expect(groups.pending[1].current.state).toBe('held')
})

it('is empty without an analysis or output', () => {
  expect(reviewGroups(undefined)).toEqual({ pending: [], approved: [], rejected: [] })
  expect(reviewGroups({ ...analysis([], []), output: null })).toEqual({ pending: [], approved: [], rejected: [] })
})
