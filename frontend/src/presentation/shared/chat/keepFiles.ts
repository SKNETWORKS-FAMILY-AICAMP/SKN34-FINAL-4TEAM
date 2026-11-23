import type { DragEvent } from 'react'

/** 끌어다 놓은 파일을 브라우저가 열어 화면을 떠나지 않게 기본 동작을 막는다. ChatPanel과, 그 밖에 있는 채팅의 머리줄·대화 고르기 줄이 함께 쓴다. */
export const keepFiles = { onDragOver: (e: DragEvent) => e.preventDefault(), onDrop: (e: DragEvent) => e.preventDefault() }
