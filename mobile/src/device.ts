import * as Notifications from 'expo-notifications'

import { noticeLabel, type AppNotification } from './notification.ts'

// 앱이 foreground일 때도 배너를 보여 준다(로컬 알림·simctl push 모두).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

/** iOS는 첫 호출에 허용 창이 뜨고, Android 13 이상은 POST_NOTIFICATIONS를 요청한다. 거절해도 웹은 그대로 쓸 수 있다(알림만 오지 않는다). */
export const requestNotificationPermission = () => Notifications.requestPermissionsAsync()

/** 앱 사용 중 도착한 새 알림(웹이 브리지로 알려 준 것)을 OS 알림으로 띄운다. data의 null은 빼고(plist에 넣을 수 없다) 탭했을 때 noticeTarget 규칙으로 이동한다. */
export function showLocalNotification(n: AppNotification) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: noticeLabel(n.kind),
      body: n.summary,
      data: { kind: n.kind, ...(n.targetType ? { targetType: n.targetType } : {}), ...(n.targetId ? { targetId: n.targetId } : {}) },
    },
    trigger: null,
  })
}
