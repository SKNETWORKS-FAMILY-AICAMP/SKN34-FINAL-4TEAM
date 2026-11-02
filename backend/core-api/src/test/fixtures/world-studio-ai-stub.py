"""Contract transport fixture. No provider SDK, credentials or outbound HTTP."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

root = Path(__file__).resolve().parents[5]
out = root / 'output/world-studio'
topics = json.loads((root / 'frontend/src/data/api/initial-topics.json').read_text(encoding='utf-8'))
calls = 0

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply(200, {'stubRequests': calls, 'paidRequests': 0})

    def reply(self, status, value):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(value, ensure_ascii=False).encode())

    def do_POST(self):
        global calls
        calls += 1
        if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
            chunks = []
            while True:
                size = int(self.rfile.readline().split(b';', 1)[0].strip(), 16)
                if not size:
                    self.rfile.readline()
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)
            raw = b''.join(chunks)
        else:
            raw = self.rfile.read(int(self.headers['Content-Length']))
        body = json.loads(raw)
        (out / 'stub-count.json').write_text(json.dumps({'stubRequests': calls, 'paidRequests': 0}), encoding='utf-8')
        if (out / 'stub-fail').exists():
            self.reply(422, {'detail': {'message': 'fixture validation failure', 'contractVersion': 'initial-content-4-minimal', 'rawOutput': '{"fixture":"invalid-reference"}', 'usage': {'test_transport': 'local_stub'}, 'diagnostics': [{'record_id': 'r1', 'field': 'records.0.evidence', 'code': 'evidence_reference', 'cause': '존재하지 않는 근거입니다. 원문을 확인해 주세요.', 'status': 'error'}]}})
            return
        source = next(s for s in body['sources'] if s['id'] == 'description')
        item = {'id': 'r1', 'kind': 'event', 'title': '등대 건립', 'text': source['text'], 'category': 'history', 'topics': ['history.past_event'], 'evidence': [{'sourceId': 'description', 'quote': source['text']}]}
        rows = [{'topic': t, 'status': 'present' if t == 'history.past_event' else 'not_provided', 'itemIds': [], 'evidence': item['evidence'] if t == 'history.past_event' else []} for t in topics if t != 'basic.name']
        self.reply(200, {'contractVersion': 'initial-content-4-minimal', 'items': [item], 'coverage': rows, 'rawOutput': '{"fixture":"local-semantic-response"}', 'usage': {'test_transport': 'local_stub', 'requests': 0}})

if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 8105), Handler).serve_forever()
