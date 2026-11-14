"""Celery 앱(회차 원고 전처리 worker). 브로커는 기존 RabbitMQ이고 결과 저장소는 쓰지 않는다(DEC-50).

worker는 `celery -A app.worker:celery worker`로 띄우고, 접수 API는 같은 앱으로 작업을 등록만 한다.
브로커 주소는 `CELERY_BROKER_URL`이며 비어 있을 때 localhost로 대신 연결하지 않는다(접수 API가 503으로 거절한다).
"""
import os

from celery import Celery

celery = Celery('storyfork-ai', broker=os.environ.get('CELERY_BROKER_URL'), include=['app.preprocessing.tasks'])
celery.conf.update(
    task_ignore_result=True,                    # 결과 저장소 없음: 진행·결과는 Content 작업 상태와 작업 디렉터리에만 남는다
    worker_prefetch_multiplier=1,               # 모델 호출이 길어 task를 미리 쌓아 두지 않는다
    broker_connection_retry_on_startup=True,    # worker가 broker보다 먼저 떠도 연결될 때까지 기다린다
    task_serializer='json',
    accept_content=['json'],
)
