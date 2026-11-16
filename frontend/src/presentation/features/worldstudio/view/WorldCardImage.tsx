import { useEffect, useId, useRef, type ReactNode } from 'react'

import { PlusIcon } from '../../../shared/icons'
import { useCardImageUrl, type CardImages } from '../viewmodel/useCardImages'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 설정집 게시판 줄과 편집 화면 레일 항목의 작은 썸네일: 이미지가 있는 카드만 그린다(없으면 비워 두고 지금처럼 제목만). 제목이 바로 옆에 있어 대체 글은 비운다.
 * 읽는 동안은 같은 크기의 빈 자리로 줄이 흔들리지 않게 하고, 읽지 못하면 비워 둔다(이유는 편집 화면의 미리보기가 알린다).
 */
export function CardThumb({ images, imageId }: { images: CardImages; imageId?: string }) {
  const { url, pending } = useCardImageUrl(images, imageId)
  if (url) return <img className="board-thumb" src={url} alt="" width={28} height={28} />
  return pending ? <span className="board-thumb" aria-hidden="true" /> : null
}

/**
 * 편집 화면 머리 오른쪽의 카드 대표 이미지 타일(#401): 세계관 관리 헤더의 표지와 같은 `.cov` 타일(3:4·둥근 모서리·그림자)이다.
 * 이미지가 없으면 타일 자체가 점선 빈 칸이고 그 안이 파일 선택(`이미지 추가`)이다. 이미지가 있으면 타일을 채우고(대체 글은 `${제목} 이미지`) 아래에 `바꾸기`·`빼기`가 놓인다.
 * 파일을 고르면 곧바로 올린다(`.ep-file-pick` 관례: 기본 파일 입력을 라벨 위에 투명하게 덮어 키보드로 닿는다). 올리는 동안은 타일 아래에서 알리고 잠그며, 실패는 화면 위 오류로 서버가 준 이유 그대로 알린다.
 * 올리면 초안 카드가 새 이미지를 가리킬 뿐이라 `세계관 저장`과 확정 버전을 거쳐야 공개 화면에 나온다. 목업 모드의 발표용 인물 초상(`portrait`)은 이미지가 없을 때 같은 타일 자리에 보이고, 카드 이미지 저장소가 없는 데모는 올리기를 잠그며 이유를 타일 아래에 알린다.
 * 안내(`PNG·JPEG·WebP, 5 MiB 이하`)는 빈 타일 안에 작게 보이고(좁은 화면은 CSS가 화면에서만 숨긴다), 이미지가 있으면 화면에서는 숨기고 입력의 설명으로만 남긴다(`sr-only`).
 * 올리는 동안 잠긴 칸과 사라진 `빼기` 버튼 대신, 요청이 끝난 뒤 같은 자리의 파일 칸으로 초점을 돌려준다.
 */
export function CardImageControl({ vm, cardId, title, imageId, portrait }: { vm: VM; cardId: string; title: string; imageId?: string; portrait?: string }) {
  const note = useId()
  const input = useRef<HTMLInputElement>(null)
  const refocus = useRef(false)
  const shown = useCardImageUrl(vm.cardImages, imageId)
  useEffect(() => {
    if (!refocus.current || vm.busy) return
    refocus.current = false
    input.current?.focus()
  })
  const supported = vm.cardImages.supported
  // 타일을 채우는 그림: 올린 이미지(읽는 중·읽지 못함이면 url이 비어 빈 자리) 또는 목업의 발표용 인물 초상.
  const picture = imageId ? { url: shown.url, alt: `${title} 이미지` } : portrait ? { url: portrait, alt: `${title} 인물 이미지` } : undefined
  const inTile = !picture && supported // 안내는 쓸 수 있는 빈 타일 안에만 보인다
  const pick = (text: string, className: string, icon?: ReactNode) => (
    <label className={className}>
      {icon}
      {text}
      <input
        ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={!supported} aria-describedby={note}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = '' // 같은 파일을 다시 골라도 바뀐 것으로 읽히게 한다
          if (!file) return
          refocus.current = true
          void vm.uploadCardImage(cardId, file)
        }}
      />
    </label>
  )
  const hint = supported ? 'PNG·JPEG·WebP, 5 MiB 이하' : '데모에서는 이미지 업로드를 지원하지 않아요.'
  const hintNote = (
    <p id={note} className={inTile ? 'world-card-tile-note' : `small muted world-card-image-note${supported ? ' sr-only' : ''}`}>{hint}</p>
  )
  return (
    <div className="world-card-image" role="group" aria-label="대표 이미지">
      <div className={`cov world-card-tile${picture ? '' : ' empty'}`}>
        {picture
          ? (picture.url ? <img src={picture.url} alt={picture.alt} /> : <span className="world-card-tile-wait" aria-hidden="true" />)
          : <>{pick('이미지 추가', 'world-card-tile-add ep-file-pick', <PlusIcon size={22} />)}{inTile && hintNote}</>}
      </div>
      {picture && (
        <div className="world-card-image-actions">
          {pick(imageId ? '바꾸기' : '이미지 추가', 'btn sm ep-file-pick')}
          {imageId && <button type="button" className="btn sm" onClick={() => { refocus.current = true; vm.removeCardImage(cardId) }}>빼기</button>}
        </div>
      )}
      {!inTile && hintNote}
      {vm.imageUploading && <p role="status" className="small muted world-card-image-note">이미지를 올리고 있어요…</p>}
      {shown.error && <p role="status" className="small muted world-card-image-note">{shown.error}</p>}
    </div>
  )
}
