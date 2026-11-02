import { appContainer } from '../../../app/appContainer'
import { useAppSelector } from '../../../app/store'
import type { ShellUseCase } from '../../../domain/usecases/ShellUseCase'
import { useAsyncData } from '../useAsyncData'

export function useGnbViewModel(shellUseCase: ShellUseCase = appContainer.resolve('shellUseCase')) {
  const { role, user } = useAppSelector((s) => s.session)
  const { data } = useAsyncData(() => shellUseCase.getBadges(), [shellUseCase])
  return { role, initial: (user.nick || '나').slice(0, 1), unread: data?.unread ?? 0, pending: data?.pending ?? 0 }
}
