import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { palette } from './appearance.ts'
import { TabIcon } from './TabIcons.tsx'
import { TABS, type TabKey } from './tabs.ts'

/** 앱이 그리는 하단 탭. 배경이 홈 표시줄(하단 안전 영역)까지 채워 화면 아래에 빈 띠가 남지 않는다. 누르면 그 탭의 웹 경로로 이동한다. */
export function TabBar({ selected, dark, onSelect }: { selected: TabKey | null; dark: boolean; onSelect: (path: string) => void }) {
  const { bottom } = useSafeAreaInsets()
  const colors = palette(dark)
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: bottom, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {TABS.map((tab) => {
        const on = tab.key === selected
        const color = on ? colors.pri : colors.sub
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(tab.path)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <TabIcon name={tab.key} color={color} />
            <Text style={[styles.label, { color, fontWeight: on ? '600' : '500' }]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6, paddingBottom: 4 },
  label: { fontSize: 11 },
  pressed: { opacity: 0.6 },
})
