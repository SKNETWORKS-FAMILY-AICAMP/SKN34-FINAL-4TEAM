"""Content의 현재 작업 위임만 HTTP로 확인한다. 원고 읽기·모델·DB 접근은 없다."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import secrets
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, ProxyHandler, build_opener

from pydantic import AwareDatetime, Field, ValidationError, StrictBool

from app.retrieval.contracts import Contract
from app.retrieval.live_contract import RetrievalSnapshot
from .schemas import RunError, RunRequest
from .state import Ref


class GrantVerification(Contract):
    run_id: Ref = Field(alias="runId")
    thread_ref: Ref = Field(alias="threadRef")
    scope_ref: Ref = Field(alias="scopeRef")
    expires_at: AwareDatetime = Field(alias="expiresAt")
    cancelled: StrictBool = False


@dataclass(frozen=True)
class RemoteGrant:
    request: RunRequest = field(repr=False)
    scope_ref: str
    cancelled: bool = False


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class RemoteContent:
    def __init__(self, base_url: str, token: str):
        origin = urlsplit(base_url)
        if (origin.scheme not in ("http", "https") or not origin.netloc or origin.username is not None
                or origin.password is not None or origin.path not in ("", "/") or origin.query or origin.fragment):
            raise ValueError("invalid_content_origin")
        self.base_url, self.token = base_url.rstrip("/"), token
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self._requests: dict[str, RunRequest] = {}

    def _post(self, request, path, limit):
        if not self.token.strip():
            raise RunError(503, "content_unavailable")
        call = Request(f"{self.base_url}/internal/v1/ai/runs/{request.run_id}/{path}",
            data=request.model_dump_json(by_alias=True).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Internal-Token": self.token})
        try:
            with self.opener.open(call, timeout=3) as response:
                raw = response.read(limit + 1)
            if len(raw) > limit:
                raise ValueError("oversized_verification")
            return json.loads(raw)
        except HTTPError as error:
            if error.code in (401, 403, 404, 409):
                raise RunError(403, "invalid_scope") from None
            raise RunError(503, "content_unavailable") from None
        except (URLError, OSError, TimeoutError, ValueError, ValidationError):
            raise RunError(503, "content_unavailable") from None

    def retrieval(self, request):
        try:
            return RetrievalSnapshot.model_validate(
                self._post(request, "retrieval", 1_000_000)).model_dump(mode="json")
        except ValidationError:
            raise RunError(503, "content_unavailable") from None

    def authorize(self, request: RunRequest) -> RemoteGrant:
        try:
            verified = GrantVerification.model_validate(self._post(request, "verify", 16384))
        except ValidationError:
            raise RunError(503, "content_unavailable") from None
        if (verified.run_id != request.run_id or verified.thread_ref != request.thread_ref
                or verified.expires_at <= datetime.now(timezone.utc)):
            raise RunError(403, "invalid_scope")
        self._requests[request.run_id] = request
        return RemoteGrant(request, verified.scope_ref, verified.cancelled)

    def restore(self, run_id: str, grant_ref: str, thread_ref: str) -> RemoteGrant:
        request = self._requests.get(run_id)
        if (request is None or request.thread_ref != thread_ref
                or not secrets.compare_digest(request.grant_ref.encode(), grant_ref.encode())):
            raise RunError(403, "invalid_scope")
        return self.authorize(request)
