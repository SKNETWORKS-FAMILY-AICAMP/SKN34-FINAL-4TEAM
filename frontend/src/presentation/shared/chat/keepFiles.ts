import type { DragEvent } from 'react'

/** 파일을 끄는 중인지. 첨부로 받을지(ChatPanel)를 가른다. */
export const isFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false

const FIELD = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

// 파일은 어디서나 막고(열려서 화면을 떠난다), 글자·링크는 놓는 곳이 입력칸일 때만 브라우저에 맡겨 입력창·제목 칸에 놓을 수 있게 한다(그 밖에서는 링크로 이동한다, #706).
const keep = (e: DragEvent) => { if (isFileDrag(e) || !(e.target instanceof Element && e.target.closest(FIELD))) e.preventDefault() }

/** 끌어다 놓은 것을 브라우저가 열거나 그 링크로 이동해 화면을 떠나지 않게 기본 동작을 막는다. ChatPanel과, 그 밖에 있는 채팅의 머리줄·대화 고르기 줄이 함께 쓴다. */
export const keepFiles = { onDragOver: keep, onDrop: keep }
