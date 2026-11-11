"""공개 발행본을 주기적으로 읽고 없는 구간만 색인한다. 작가 자격은 사용하지 않는다."""
import asyncio
import json
import logging
from urllib.request import ProxyHandler, build_opener

from app.runs.remote_content import NoRedirect
from .live import index_manuscripts, split_excerpt


def index_page(works, write=index_manuscripts):
    for work in works:
        if work["visibility"] != "public" or work["draft"] is not None:
            raise ValueError("not_a_public_projection")
        work_id = work["id"]
        fork = work_id if work["source"] else None
        for ep in work["episodes"]:
            write({key:quote for key,quote,*_ in split_excerpt(
                work_id, fork, ep["number"], ep["versionId"], 0, ep["body"])})


async def sync_public(base_url):
    opener = build_opener(ProxyHandler({}), NoRedirect())
    def read(page):
        with opener.open(f"{base_url}/api/v1/public/works?page={page}&size=4", timeout=20) as response:
            raw = response.read(16_000_001)
            if len(raw) > 16_000_000:
                raise ValueError("public_page_too_large")
            return json.loads(raw)

    # shortcut: 단일 AI의 시연용 목록 순회, 다중 worker·많은 작품이면 Content outbox와 영속 cursor로 전환한다.
    while True:
        try:
            page = 0
            while True:
                works = await asyncio.to_thread(read, page)
                for work in works:
                    try:
                        await asyncio.to_thread(index_page, [work])
                    except Exception:
                        logging.getLogger(__name__).warning("manuscript_index_work_failed")
                if len(works) < 4:
                    break
                page += 1
        except Exception:
            logging.getLogger(__name__).warning("manuscript_index_sync_failed")
        await asyncio.sleep(300)
