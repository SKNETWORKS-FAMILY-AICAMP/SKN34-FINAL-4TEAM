import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { uiActions, type Look } from '../../../shared/ui/uiSlice'
import { useTheme } from '../../../shared/shell/useTheme'

/** 목업 S.look·S.fs·S.motion과 effLook(): '자동'은 라이트에서 소설 분위기, 다크에서 아이보리 */
export function useLook() {
  const { look, fs, motion } = useAppSelector((s) => s.ui)
  const { dark } = useTheme()
  const dispatch = useAppDispatch()
  return {
    look,
    fs,
    motion,
    dark,
    eff: look === 'auto' ? (dark ? 'ivory' : 'world') : look,
    setLook: (l: Look) => dispatch(uiActions.setLook(l)),
    changeFs: (d: number) => dispatch(uiActions.changeFs(d)),
    setMotion: (on: boolean) => dispatch(uiActions.setMotion(on)),
  }
}
