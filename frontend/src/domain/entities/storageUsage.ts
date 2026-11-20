export const storageKinds = ['manuscript', 'setting', 'manuscript_image'] as const
export type StorageKind = (typeof storageKinds)[number]

export type StorageItem = {
  id: string
  kind: StorageKind
  title: string
  parentTitle: string
  bytes: number
}

export type StorageUsage = { items: StorageItem[] }

/** 화면의 합계와 종류별 사용량. 서버는 항목만 주고 합계는 항목 크기를 더해 구한다. */
export function storageTotals(items: StorageItem[]) {
  const byKind = { manuscript: 0, setting: 0, manuscript_image: 0 } satisfies Record<StorageKind, number>
  for (const item of items) byKind[item.kind] += item.bytes
  return { total: items.reduce((sum, item) => sum + item.bytes, 0), byKind }
}

const units = ['B', 'KB', 'MB', 'GB', 'TB']
const whole = new Intl.NumberFormat('ko-KR')
const decimal = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 })

/** 1024 단위로 읽기 쉬운 크기. 정확한 바이트는 화면이 따로 보여 준다. */
export function formatBytes(bytes: number) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${(unit ? decimal : whole).format(value)} ${units[unit]}`
}

export const exactBytes = (bytes: number) => `${whole.format(bytes)}바이트`
