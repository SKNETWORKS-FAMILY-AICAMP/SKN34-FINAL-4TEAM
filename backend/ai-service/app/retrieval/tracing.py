"""Langfuse OTLP/HTTP: 원문·인물·위임·예외 메시지를 수집하지 않는다."""
import asyncio
from base64 import b64encode
from contextlib import contextmanager
from hashlib import sha256
import json
import logging
import os
from secrets import token_hex
from time import time_ns
from urllib.request import ProxyHandler, Request, build_opener

from app.runs.remote_content import NoRedirect


class RagTrace:
    def __init__(self, run_id):
        self.id = sha256(("storyfork.rag:" + run_id).encode()).hexdigest()[:32]
        self.root, self.start = token_hex(8), time_ns()
        self.spans = []

    @contextmanager
    def step(self, name, kind="retriever"):
        start = time_ns()
        ok = False
        try:
            yield
            ok = True
        finally:
            self.spans.append(self.span(name, kind, start, ok, token_hex(8)) | {"parentSpanId": self.root})

    def span(self, name, kind, start, ok, span_id):
        return {"traceId": self.id, "spanId": span_id, "name": name,
                "startTimeUnixNano": str(start), "endTimeUnixNano": str(time_ns()),
                "status": {"code": 1 if ok else 2}, "attributes": [
                    {"key": "langfuse.observation.type", "value": {"stringValue": kind}}]}

    async def finish(self, ok):
        host, public, secret = (os.environ.get(k) for k in ("LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"))
        if not any((host, public, secret)):
            return
        try:
            if not all((host, public, secret)):
                raise ValueError("incomplete_configuration")
            spans = [self.span("storyfork.rag", "chain", self.start, ok, self.root), *self.spans]
            data = {"resourceSpans": [{"scopeSpans": [{"scope": {"name": "storyfork.ai"}, "spans": spans}]}]}
            request = Request(host.rstrip("/") + "/api/public/otel/v1/traces", data=json.dumps(data).encode(),
                              headers={"Authorization": "Basic " + b64encode(f"{public}:{secret}".encode()).decode(),
                                       "Content-Type": "application/json", "x-langfuse-ingestion-version": "4"})
            def send():
                with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=2) as response:
                    body = json.loads(response.read() or b"{}")
                    if int(body.get("partialSuccess", {}).get("rejectedSpans", 0)):
                        raise ValueError("rejected_spans")
            await asyncio.to_thread(send)
        except Exception:
            logging.getLogger(__name__).warning("langfuse_rag_export_failed")
