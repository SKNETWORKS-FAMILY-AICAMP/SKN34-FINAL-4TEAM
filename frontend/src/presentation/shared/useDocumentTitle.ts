import { useEffect } from 'react'

const BRAND = 'STORYFORK'

/** 화면 이름이 있으면 `화면 · STORYFORK`, 없거나 공백이면 `STORYFORK`. */
export const documentTitleOf = (title: string | null | undefined) => {
  const name = title?.trim()
  return name ? `${name} · ${BRAND}` : BRAND
}

/** 화면이 열려 있는 동안 브라우저 탭 제목을 화면 이름으로 정하고, 닫히면 기본 제목으로 복구합니다. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = documentTitleOf(title)
    return () => { document.title = BRAND }
  }, [title])
}
