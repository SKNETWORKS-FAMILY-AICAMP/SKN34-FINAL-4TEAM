import { useState } from 'react'

/**
 * 공개 화면의 설정 카드 대표 이미지(#401): 공개 주소를 `<img>`로 직접 읽고(비로그인도 보는 화면이라 인증 읽기를 쓰지 않는다), 읽지 못하면(공개 중단·삭제·네트워크) 깨진 그림 대신 감춘다.
 * 대체 글은 카드 제목 이미지다. 화면에 가까워질 때만 읽는다(`loading="lazy"`). 다른 주소로 바뀌면 이전 주소의 실패를 이어받지 않는다.
 */
export function PublicCardImage({ src, title, className }: { src: string; title: string; className?: string }) {
  const [failed, setFailed] = useState('')
  if (failed === src) return null
  return <img className={className} src={src} alt={`${title} 이미지`} loading="lazy" onError={() => setFailed(src)} />
}
