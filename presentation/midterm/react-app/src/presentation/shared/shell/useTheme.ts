import { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { toast } from '../events'
import { sessionActions } from '../session/sessionSlice'

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

/** 목업 isDark()·data-act="theme": 선택 전에는 OS 설정을 따르고, 선택하면 html[data-theme]에 기록합니다. */
export function useTheme() {
  const theme = useAppSelector((s) => s.session.theme)
  const dispatch = useAppDispatch()
  const dark = theme ? theme === 'dark' : systemDark()
  return {
    dark,
    toggle: () => {
      dispatch(sessionActions.setTheme(dark ? 'light' : 'dark'))
      toast(dark ? '라이트 모드로 바꿨어요' : '다크 모드로 바꿨어요')
    },
  }
}

export function useApplyTheme() {
  const theme = useAppSelector((s) => s.session.theme)
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme }, [theme])
}
