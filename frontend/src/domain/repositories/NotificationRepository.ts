import type { AppNotification, NotificationPage } from '../entities/notification'

/** 회원이 끌 수 있는 알림 종류(읽기·작가 소식·AI·외부 도구 변경). 나머지 분류는 항상 켜져 있습니다. */
export type NotificationPrefs = { read: boolean; creator: boolean; aiTool: boolean }

/** 설치 앱(Android)의 설치 id와 푸시 토큰. token이 null이면 알림 권한이 꺼져 이 설치를 해제한다는 뜻입니다. */
export type PushDevice = { installationId: string; token: string | null }

export interface NotificationRepository {
  /** 최신순 한 페이지. cursor는 직전 응답의 nextCursor입니다. */
  list(cursor?: string | null, signal?: AbortSignal): Promise<NotificationPage>
  unreadCount(signal?: AbortSignal): Promise<number>
  /** 알림 한 건. 설치 앱의 알림을 눌렀을 때 넘어온 id로 이동할 화면을 정하는 데 씁니다. */
  get(id: string, signal?: AbortSignal): Promise<AppNotification>
  markRead(id: string): Promise<void>
  /** upTo(ISO) 이전에 도착한 알림만 읽음으로 바꿉니다. 그 뒤 도착분은 미읽음으로 남습니다. */
  markAllRead(upTo: string): Promise<void>
  remove(id: string): Promise<void>
  getPrefs(signal?: AbortSignal): Promise<NotificationPrefs>
  savePrefs(prefs: NotificationPrefs): Promise<NotificationPrefs>
  /** 설치 앱 기기를 현재 웹 로그인 세션에 연결하고(token), token이 null이면 이 설치만 해제합니다. */
  syncPushDevice(device: PushDevice, signal: AbortSignal): Promise<void>
}

export type { AppNotification }
