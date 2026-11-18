package ai.storyfork.content.world.domain

/**
 * 확정 버전으로 카드를 되돌리면 사라질 설정에 현재 관계가 이어져 있어 되돌리지 않았다. [titles]는 그 설정의 이름(빈 이름은 그대로)이며
 * 작가가 어느 설정의 관계부터 정리할지 알 수 있게 응답에 싣는다(409).
 */
class WorldRestoreBlocked(val titles: List<String>) : RuntimeException("되돌리면 사라질 설정에 이어진 관계가 있습니다.")
