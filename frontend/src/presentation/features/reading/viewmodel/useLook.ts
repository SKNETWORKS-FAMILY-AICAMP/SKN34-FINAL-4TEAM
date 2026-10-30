import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { sessionActions, type Look } from '../../../shared/session/sessionSlice'
import { useTheme } from '../../../shared/shell/useTheme'

/** 목업 S.look·S.fs·S.motion과 effLook(): '자동'은 라이트에서 소설 분위기, 다크에서 아이보리 */
export function useLook() {
  const { look, fs, motion } = useAppSelector((s) => s.session)
  const { dark } = useTheme()
  const dispatch = useAppDispatch()
  return {
    look,
    fs,
    motion,
    dark,
    eff: look === 'auto' ? (dark ? 'ivory' : 'world') : look,
    setLook: (l: Look) => dispatch(sessionActions.setLook(l)),
    changeFs: (d: number) => dispatch(sessionActions.changeFs(d)),
    setMotion: (on: boolean) => dispatch(sessionActions.setMotion(on)),
  }
}
