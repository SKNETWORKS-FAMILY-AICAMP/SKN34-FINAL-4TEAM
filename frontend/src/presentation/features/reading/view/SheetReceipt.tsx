import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * 접수 결과. 제출 버튼이 사라진 자리에서 키보드 위치를 잃지 않게 '확인'으로 포커스를 옮기고,
 * 결과 문구는 상태(role=status)이자 그 버튼의 설명이라 포커스가 닿을 때 함께 읽힌다.
 */
export function SheetReceipt({ status, message, onClose }: { status: string; message: ReactNode; onClose: () => void }) {
  const result = useId()
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => { ok.current?.focus() }, [])
  return (
    <>
      <div className="reply" role="status" id={result}><span className={`chip ${['접수됨', '작가 확인 전', '작가 검토 대기', '분석 중', '필터 대기'].includes(status) ? 'wait' : 'ok'}`}>{status}</span> {message}</div>
      <div className="rowend"><button ref={ok} type="button" className="btn pri" aria-describedby={result} onClick={onClose}>확인</button></div>
    </>
  )
}
