import { expect, it, vi } from 'vitest'
import { EpisodeUseCase } from '../usecases/EpisodeUseCase'
import type { EpisodeRepository } from '../repositories/EpisodeRepository'

it('rejects overlong notes before sending and accepts blank notes for removal', async () => {
  const write = vi.fn<EpisodeRepository['writeEpisode']>().mockRejectedValue(new Error('server failure'))
  const repo = { writeEpisode: write } as unknown as EpisodeRepository
  const useCase = new EpisodeUseCase(repo)
  const draft = {title:'제목',body:'본문',revision:0,authorNote:'가'.repeat(2001)}
  await expect(useCase.writeEpisode('w',1,draft,true)).rejects.toThrow('2,000자')
  expect(write).not.toHaveBeenCalled()
  await expect(useCase.writeEpisode('w',1,{...draft,authorNote:''},true)).rejects.toThrow('server failure')
  expect(write).toHaveBeenCalledWith('w',1,{...draft,authorNote:''},true,undefined)
})
