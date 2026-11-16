import { useEffect, useId, useRef } from 'react'

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
 * 편집 화면 제목 아래 줄(유형 선택 옆)의 카드 대표 이미지(#401): 이미지가 없으면 `이미지 추가`, 있으면 56px 미리보기와 `바꾸기`·`빼기`.
 * 파일을 고르면 곧바로 올린다(`.ep-file-pick` 관례: 기본 파일 입력을 라벨 버튼 위에 투명하게 덮어 키보드로 닿는다). 올리는 동안은 알리고 잠그며, 실패는 화면 위 오류로 서버가 준 이유 그대로 알린다.
 * 올리면 초안 카드가 새 이미지를 가리킬 뿐이라 `세계관 저장`과 확정 버전을 거쳐야 공개 화면에 나온다. 목업 모드의 발표용 인물 초상(`portrait`)은 이미지가 없을 때 그대로 보이고, 카드 이미지 저장소가 없는 데모는 올리기를 잠근다.
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
  return (
    <div className="world-card-image" role="group" aria-label="대표 이미지">
      {portrait && !imageId && <img src={portrait} alt={`${title} 인물 이미지`} width={56} height={56} />}
      {imageId && (shown.url
        ? <img className="world-card-image-preview" src={shown.url} alt={`${title} 이미지`} width={56} height={56} />
        : <span className="world-card-image-preview" aria-hidden="true" />)}
      <div className="world-card-image-body">
        <div className="world-card-image-actions">
          <label className="btn sm ep-file-pick">
            {imageId ? '바꾸기' : '이미지 추가'}
            <input
              ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={!vm.cardImages.supported} aria-describedby={note}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                e.currentTarget.value = '' // 같은 파일을 다시 골라도 바뀐 것으로 읽히게 한다
                if (!file) return
                refocus.current = true
                void vm.uploadCardImage(cardId, file)
              }}
            />
          </label>
          {imageId && <button type="button" className="btn sm" onClick={() => { refocus.current = true; vm.removeCardImage(cardId) }}>빼기</button>}
        </div>
        <p id={note} className="small muted world-card-image-note">{vm.cardImages.supported ? 'PNG·JPEG·WebP, 5 MiB 이하' : '데모에서는 이미지 업로드를 지원하지 않아요.'}</p>
        {vm.imageUploading && <p role="status" className="small muted world-card-image-note">이미지를 올리고 있어요…</p>}
        {shown.error && <p role="status" className="small muted world-card-image-note">{shown.error}</p>}
      </div>
    </div>
  )
}
