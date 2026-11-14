"""전처리 기반 테스트의 원고·Content·전처리 로직 대역. 실제 OpenAI·Content를 호출하지 않는다."""
from types import SimpleNamespace

from app.preprocessing import content, service
from app.preprocessing.models import Card, EpisodeText, LoadPayload, Relation

JOB = '11111111-1111-4111-8111-111111111111'
WORK = '22222222-2222-4222-8222-222222222222'


def episode(number: int) -> EpisodeText:
    return EpisodeText(number=number, title=f'{number}화', body=f'{number}화 원문')


def payload() -> LoadPayload:
    return LoadPayload(
        cards=[Card(key='char-0001', cardType='character', title='홍길동', aliases=['길동'], body='홍길동', revealFromEpisode=1),
               Card(key='loc-0001', cardType='location', title='객주', aliases=[], body='객주', revealFromEpisode=1)],
        relations=[Relation(fromKey='char-0001', toKey='loc-0001', label='출입', fromEpisode=1)])


def content_double(monkeypatch):
    """Content 전처리 도구 대역: 읽은 회차·진행 갱신·적재를 기록한다."""
    seen = SimpleNamespace(reads=[], progress=[], loads=[])

    def read(job_id, number):
        seen.reads.append(number)
        return episode(number)

    def progress(job_id, stage, done, total, failed_episodes=(), failed=None):
        seen.progress.append({'stage': stage, 'done': done, 'total': total,
                              'failedEpisodes': list(failed_episodes), 'failed': failed})

    monkeypatch.setattr(content, 'read_episode', read)
    monkeypatch.setattr(content, 'progress', progress)
    monkeypatch.setattr(content, 'load', lambda job_id, payload: seen.loads.append((job_id, payload)))
    return seen


def logic_double(monkeypatch, failing=()):
    """전처리 로직(service) 대역: 추출은 회차 번호를 돌려주고 `failing` 회차는 실패한다."""
    seen = SimpleNamespace(resolved=[], organized=[])

    def extract(page):
        if page.number in failing:
            raise RuntimeError('원고 한 줄')
        return page.number

    monkeypatch.setattr(service, 'extract', extract)
    monkeypatch.setattr(service, 'resolve', lambda extractions: seen.resolved.append(extractions) or 'identities')
    monkeypatch.setattr(service, 'organize', lambda identities, extractions: seen.organized.append(identities) or payload())
    return seen
