package ai.storyfork.core.world.domain

class WorldConflict : RuntimeException("다른 편집본 또는 저장 요청과 충돌했습니다.")
