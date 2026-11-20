import { describe, expect, it } from 'vitest'

import { exactBytes, formatBytes, storageTotals, type StorageItem } from '../entities/storageUsage'

const item = (kind: StorageItem['kind'], bytes: number): StorageItem => ({ id: `${kind}-${bytes}`, kind, title: '항목', parentTitle: '작품', bytes })

describe('저장 사용량 (U30)', () => {
  it('합계와 종류별 사용량은 항목 크기를 더해 구한다', () => {
    expect(storageTotals([item('manuscript', 3), item('setting', 6), item('setting', 9), item('manuscript_image', 3_000_000_000)])).toEqual({
      total: 3_000_000_018, byKind: { manuscript: 3, setting: 15, manuscript_image: 3_000_000_000 },
    })
    expect(storageTotals([])).toEqual({ total: 0, byKind: { manuscript: 0, setting: 0, manuscript_image: 0 } })
  })

  it('크기는 1024 단위로 읽기 쉽게, 정확한 값은 바이트로 쓴다', () => {
    expect([0, 1023, 1024, 1536, 2_483_211, 3_000_000_000].map(formatBytes)).toEqual(['0 B', '1,023 B', '1 KB', '1.5 KB', '2.4 MB', '2.8 GB'])
    expect(exactBytes(2_483_211)).toBe('2,483,211바이트')
  })
})
