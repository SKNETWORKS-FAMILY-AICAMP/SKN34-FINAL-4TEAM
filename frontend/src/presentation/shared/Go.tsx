import type { ButtonHTMLAttributes } from 'react'
import { useNavigate } from 'react-router'

/** 목업 data-go 버튼: 목업 CSS가 button 요소 기준이라 링크 대신 버튼으로 이동합니다. */
export function Go({ to, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { to: string }) {
  const navigate = useNavigate()
  return <button type="button" {...props} onClick={(e) => { onClick?.(e); navigate(to) }} />
}
