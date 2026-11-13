import type { FormEvent } from 'react'

import { Art } from '../../../shared/art'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 새 세계관 만들기(`/worldstudio`). 새 작품 만들기(`/content`)와 같은 모양(표지 자리 | 이름·소개)이고, 만들면 그 세계관의 마법사(`/worldstudio/:id?new=1`)로 간다.
 * 내 세계관 목록은 서재(`/lib?tab=worlds`)가 맡지만, 편집 중에 다른 세계관을 열거나 이어서 작성하는 길이라 만들기 아래에 작게 남긴다.
 */
export function WorldCreate({ vm }: { vm: VM }) {
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    vm.create(String(form.get('name') ?? ''), String(form.get('description') ?? ''))
  }
  return (
    <section className="ep-create world-library" aria-busy={vm.busy}>
      <h1>새 세계관 만들기</h1>
      <p className="ep-lead">
        한 줄의 설정에서 시작해, 당신만의 세계를 펼쳐 보세요.<br />세계관은 비공개로 만들어지고, 설정 카드와 관계는 나중에 채워도 돼요.
      </p>
      <form onSubmit={create}>
        <div className="whero ep-hero">
          <div className="ep-hero-cover">
            <div className="cov"><Art theme="star" w={300} h={400} seed="new-world" /><div className="tg"><span className="tag dk">새 세계관</span></div></div>
            <p className="small muted">표지는 세계관마다 자동으로 만들어져요.</p>
          </div>
          <div className="ep-hero-main ep-create-fields">
            <label className="ep-create-title">세계관 이름<input name="name" required maxLength={100} placeholder="어떤 세계를 만들까요?" /></label>
            <label>설명 <span className="ep-optional">선택</span><textarea name="description" rows={4} maxLength={20000} placeholder="어떤 시대와 배경에서 시작하나요? 이 세계만의 규칙을 짧게 적어 주세요." /></label>
            <div className="ep-form-footer">
              <span>◌ 처음에는 나만 볼 수 있어요</span>
              <button className="btn pri" disabled={vm.busy}>세계관 만들기</button>
            </div>
          </div>
        </div>
      </form>
      <div className="ep-steps">
        <div><b>01</b><strong>정하고</strong><p>이름과 소개로 세계를 시작해요.</p></div>
        <div><b>02</b><strong>채우고</strong><p>인물·장소 같은 설정 카드를 써요.</p></div>
        <div><b>03</b><strong>잇고</strong><p>인물 사이의 관계를 이어 한눈에 살펴요.</p></div>
      </div>
      <section className="world-library-list">
        <div className="world-toolbar"><h2>내 세계관</h2>{vm.editing && <button className="btn" type="button" onClick={vm.resume}>이어서 작성</button>}</div>
        <p className="small muted">{vm.storage.library}</p>
        <nav aria-label="내 세계관">
          {vm.worlds.map((w) => (
            <button key={w.id} type="button" disabled={vm.busy} onClick={() => vm.editing?.id === w.id ? vm.resume() : vm.open(w.id)}>
              <strong>{w.name}</strong>
              <small>{w.description || '세계관 설명 없음'}{w.relationshipStatus === 'incomplete' ? ' · 저장 미완료' : w.relationshipStatus === 'migration_required' ? ' · 기존 데이터 전환 필요' : ''}</small>
            </button>
          ))}
        </nav>
        {!vm.busy && !vm.worlds.length && !vm.error && <p className="muted">아직 저장한 세계관이 없어요. 이름부터 정해 시작해 보세요.</p>}
      </section>
    </section>
  )
}
