"""격리된 #428 checkout의 Python 환경에서 실행. DB/HTTP/실모델 검증이 아니다."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_STORED

parser = argparse.ArgumentParser()
parser.add_argument('--ai-root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.ai_root.resolve()))
from app.manuscript_extraction import service
from app.manuscript_extraction.models import EpisodeText
from app.manuscript_extraction.errors import PreprocessingFailure

args.output.mkdir(parents=True, exist_ok=True)
def write(name, value):
    (args.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

fixture = json.loads((args.ai_root / 'tests/preprocessing/fixtures/four-episodes.json').read_text(encoding='utf-8'))
episodes = fixture['episodes']
with patch.object(service.agent, 'extract', side_effect=lambda ep: episodes[ep.number-1]['output']), \
     patch.object(service.agent, 'resolve', return_value=fixture['resolution']):
    rows = {e['number']: service.extract(EpisodeText(number=e['number'], title=e['title'], body=e['body'])) for e in episodes}
    identity = service.resolve(rows)
    payload = service.organize(identity, rows)
    assert service.organize(identity, dict(reversed(list(rows.items())))) == payload
    assert len(payload.cards) == 5 and len(payload.relations) == 2
    assert all(r.fromKey in {c.key for c in payload.cards} and r.toKey in {c.key for c in payload.cards} for r in payload.relations)
    write('four-extractions.json', {n:r.model_dump(mode='json') for n,r in rows.items()})
    write('four-identity.json', identity.model_dump(mode='json'))
    write('four-load-payload.json', payload.model_dump(mode='json'))

# Upload inputs only: no server version IDs are invented.
for ep in episodes:
    (args.output / f"episode-{ep['number']:02}.txt").write_text(ep['body'], encoding='utf-8')
with ZipFile(args.output / 'four-episodes.epub', 'w') as z:
    z.writestr('mimetype', 'application/epub+zip', compress_type=ZIP_STORED)
    z.writestr('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    items = ''.join(f'<item id="c{e["number"]}" href="c{e["number"]}.xhtml" media-type="application/xhtml+xml"/>' for e in episodes)
    spine = ''.join(f'<itemref idref="c{e["number"]}"/>' for e in episodes)
    z.writestr('book.opf', f'<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">synthetic-qa</dc:identifier><dc:title>QA 원고</dc:title><dc:language>ko</dc:language></metadata><manifest>{items}</manifest><spine>{spine}</spine></package>')
    for e in episodes:
        body = ''.join(f'<p>{escape(line)}</p>' for line in e['body'].splitlines())
        z.writestr(f'c{e["number"]}.xhtml', f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{escape(e["title"])}</title></head><body>{body}</body></html>')

# 100 source inputs, no invented persisted manifest or persisted successful results.
hundred = [EpisodeText(number=n, title=f'{n}화', body=f'인물{n}은 마을에 있다.') for n in range(1,101)]
def extracted(ep):
    return dict(mentions=[dict(id='m1', name=f'인물{ep.number}', kind='character', quote=ep.body)], statements=[], relationships=[])
with patch.object(service.agent, 'extract', side_effect=extracted), patch.object(service.agent, 'resolve', return_value={'links': []}):
    rows100 = {e.number:service.extract(e) for e in hundred}
    identity100 = service.resolve(rows100)
    payload100 = service.organize(identity100, rows100)
    assert len(rows100) == 100 and len(payload100.cards) == 100
    assert service.organize(identity100, dict(reversed(list(rows100.items())))) == payload100
    try:
        service.organize(identity100, {n:r for n,r in rows100.items() if n != 100})
    except PreprocessingFailure:
        pass
    else:
        raise AssertionError('Missing episode must not reuse complete identity resolution')
write('hundred-sources.json', [e.model_dump() for e in hundred])
write('hundred-source-hashes.json', {n:r.sourceHash for n,r in rows100.items()})
write('results.json', {'four_episode_provider_stub': 'PASS', 'hundred_minimal_provider_stub': 'PASS',
    'missing_episode_with_existing_resolution_rejected': 'PASS', 'http_upload': 'NOT TESTED',
    'database_persistence': 'NOT TESTED', 'existing_world_merge': 'BLOCKED',
    'note': '100 tiny episodes verify mechanics, not full-length novel capacity or LLM quality.',
    'source_sha256': {e['number']:hashlib.sha256(e['body'].encode()).hexdigest() for e in episodes}})
print('PASS: four-episode payload; 100 tiny episodes; order stability; missing episode rejection. No network/DB calls.')
