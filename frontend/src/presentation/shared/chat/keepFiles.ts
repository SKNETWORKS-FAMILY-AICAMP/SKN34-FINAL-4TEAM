import type { DragEvent } from 'react'

/** 파일을 끄는 중인지. 글자 끌기는 막지 않아야 입력창·제목 칸에 놓을 수 있다(#706). */
export const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files')

const keep = (e: DragEvent) => { if (isFileDrag(e)) e.preventDefault() }

/** 끌어다 놓은 파일을 브라우저가 열어 화면을 떠나지 않게 기본 동작을 막는다. ChatPanel과, 그 밖에 있는 채팅의 머리줄·대화 고르기 줄이 함께 쓴다. */
export const keepFiles = { onDragOver: keep, onDrop: keep }
