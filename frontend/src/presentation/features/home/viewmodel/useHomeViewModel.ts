import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { HOME_CHIPS, type ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { showRouteProgress } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

export function useHomeViewModel(readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const { role, chip, guide, firstHome } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const { data, isError } = useAsyncData(() => readingUseCase.getHome(role, chip), [readingUseCase, role, chip])
  useScreenId(chip === HOME_CHIPS[0][0] ? 'U01' : 'U02')
  return {
    home: data,
    isError,
    chips: HOME_CHIPS.map((c) => c[0]),
    chip,
    guide,
    firstHome,
    selectChip: (c: string) => { showRouteProgress(); dispatch(sessionActions.setChip(c)) },
    closeGuide: () => dispatch(sessionActions.closeGuide()),
    homeVisited: () => dispatch(sessionActions.homeVisited()),
    markSeen: (id: string) => { void readingUseCase.markSeen(id).then(() => dispatch(sessionActions.dataChanged())) },
  }
}
