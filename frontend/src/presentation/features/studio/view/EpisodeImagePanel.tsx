import { useState } from 'react'

import type { Draft } from '../../../../domain/entities/content'
import type { EpisodeImage } from '../../../../domain/entities/media'
import { useEpisodeImageViewModel } from '../viewmodel/useEpisodeImageViewModel'
import './episode-images.css'

type Props = { workId: string; episode: number; draft: Draft; unsaved: boolean; onDraftSaved: () => void }

/** 집필실 회차 이미지 관리: 목록·대체 텍스트 저장·본문에서 빼기(이미지 파일은 지우지 않는다). */
export function EpisodeImagePanel({ workId, episode, draft, unsaved, onDraftSaved }: Props) {
  const vm = useEpisodeImageViewModel({ workId, episode, draft, unsaved, onDraftSaved })
  return (
    <section className="episode-images" aria-label="회차 이미지">
      <h3>회차 이미지</h3>
      <p className="small muted">이 회차에 올린 이미지예요. 설명(대체 텍스트)은 이미지마다 하나이고, 저장하면 발행본 화면에도 바로 반영돼요. 본문에서 빼면 현재 초안에서 표식만 지우고 이미지 파일은 저장 버전·발행본을 위해 남겨 둬요.</p>
      {unsaved && <p className="small muted">저장하지 않은 입력이 있거나 저장 중이에요. 저장이 끝난 뒤에 본문에서 뺄 수 있어요. 자동 저장은 입력을 멈추고 2초 뒤에 시작해요.</p>}
      {vm.error && <p role="alert">{vm.error}</p>}
      {vm.notice && <p role="status">{vm.notice}</p>}
      {vm.loading ? <p role="status">이미지를 불러오고 있어요…</p>
        : vm.images.length ? <fieldset disabled={vm.busy}>
          <legend className="sr-only">이미지 목록</legend>
          <ul className="episode-image-list">{vm.images.map((image) => <ImageRow key={image.id} image={image} canRemove={!unsaved} onSave={(alt) => vm.saveAlt(image, alt)} onRemove={() => vm.removeFromBody(image)} />)}</ul>
        </fieldset>
        : !vm.error && <p>이 회차에 올린 이미지가 없어요.</p>}
      <button type="button" className="btn sm" onClick={vm.reload}>이미지 목록 새로고침</button>
    </section>
  )
}

function ImageRow({ image, canRemove, onSave, onRemove }: { image: EpisodeImage; canRemove: boolean; onSave: (altText: string) => Promise<boolean>; onRemove: () => Promise<boolean> }) {
  // 저장에 실패해도 입력한 설명이 남도록 입력값은 행이 들고 있는다.
  const [alt, setAlt] = useState(image.altText)
  return (
    <li>
      <p><strong>{image.filename}</strong> · <span>{(image.byteSize / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} KiB</span> <span className={`chip ${image.referenced ? 'ok' : ''}`}>{image.referenced ? '본문에 사용 중' : '본문에 없음'}</span></p>
      <form onSubmit={(e) => { e.preventDefault(); void onSave(alt) }}>
        <label className="field">이미지 설명 · {image.filename}<input className="inp" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} /></label>
        <button type="submit" className="btn sm">설명 저장 · {image.filename}</button>
      </form>
      <button type="button" className="btn sm" disabled={!image.referenced || !canRemove} onClick={() => void onRemove()}>본문에서 빼기 · {image.filename}</button>
    </li>
  )
}
