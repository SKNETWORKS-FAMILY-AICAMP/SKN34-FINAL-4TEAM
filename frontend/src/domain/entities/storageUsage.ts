export const storageKinds = ['manuscript', 'setting', 'manuscript_image'] as const

export type StorageUsage = {
  totalBytes: number
  manuscriptBytes: number
  settingBytes: number
  manuscriptImageBytes: number
  items: {
    id: string
    kind: (typeof storageKinds)[number]
    title: string
    parentTitle: string
    bytes: number
  }[]
}
