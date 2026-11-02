import { useTheme } from './useTheme'

export function ThemeButton({ className = 'thm' }: { className?: string }) {
  const { dark, toggle } = useTheme()
  return <button type="button" className={className} aria-label={dark ? '라이트 모드로' : '다크 모드로'} onClick={toggle}>{dark ? '☀' : '☾'}</button>
}
