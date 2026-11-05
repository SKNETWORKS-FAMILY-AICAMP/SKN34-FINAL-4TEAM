import { Link, type LinkProps } from 'react-router'

/** 이동은 네이티브 링크로, 비활성 회차는 주소 없는 비활성 링크로 표시합니다. */
export function Go({ to, state, disabled, className, onClick, ...props }: LinkProps & { disabled?: boolean }) {
  if (disabled) return <a {...props} data-route-link className={className} role="link" aria-disabled="true" tabIndex={-1} onClick={(e) => e.preventDefault()} />
  return <Link {...props} data-route-link to={to} state={state} className={className} onClick={onClick} />
}
