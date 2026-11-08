/**
 * Game tab hub — a slim profile summary (level, HP, XP progress, gold)
 * over the menu of game-parity screens pushed under /game/*.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/api/auth';
import { gameApi } from '@/api/game';
import { Colors, Spacing } from '@/constants/colors';

interface MenuItem {
  href: Href;
  title: string;
  subtitle: string;
  icon: SymbolViewProps['name'];
}

const MENU: MenuItem[] = [
  {
    href: '/game/habits',
    title: 'Habits',
    subtitle: 'Score routines with +/− taps',
    icon: { ios: 'repeat', android: 'repeat', web: 'repeat' },
  },
  {
    href: '/game/dailies',
    title: 'Dailies',
    subtitle: 'Check off recurring quests',
    icon: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  },
  {
    href: '/game/profile',
    title: 'Character',
    subtitle: 'Stats, class, and gear',
    icon: { ios: 'person', android: 'person', web: 'person' },
  },
  {
    href: '/game/shop',
    title: 'Shop',
    subtitle: 'Spend gold on gear',
    icon: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  },
  {
    href: '/game/activity',
    title: 'Activity',
    subtitle: 'Contribution grid and stats',
    icon: { ios: 'square.grid.3x3', android: 'grid_on', web: 'grid_on' },
  },
  {
    href: '/game/timeline',
    title: 'Timeline',
    subtitle: 'Sessions and events by day',
    icon: { ios: 'clock', android: 'schedule', web: 'schedule' },
  },
  {
    href: '/game/diary',
    title: 'Diary',
    subtitle: 'Stand-ups and notes',
    icon: { ios: 'book.closed', android: 'menu_book', web: 'menu_book' },
  },
];

function ProfileHeader() {
  const { token } = useAuth();
  const {
    data: profile,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['game-profile'],
    queryFn: () => gameApi.getProfile(),
    enabled: !!token,
  });

  if (isLoading) {
    return <ActivityIndicator color={Colors.accent} style={styles.profileFallback} />;
  }
  if (isError || profile === undefined) {
    return <Text style={styles.profileFallback}>Game profile unavailable</Text>;
  }

  const xpPct =
    profile.xp_to_next_level > 0
      ? Math.min(1, Math.max(0, profile.xp / profile.xp_to_next_level))
      : 0;

  return (
    <View style={styles.profileCard}>
      <View style={styles.profileRow}>
        <Text style={styles.levelText}>
          Lv {profile.level}
          {profile.game_class ? ` · ${profile.game_class}` : ''}
        </Text>
        <Text style={styles.chip}>
          HP {Math.floor(profile.hp)}/{Math.floor(profile.max_hp)}
        </Text>
        <Text style={styles.gold}>{Math.floor(profile.gold)}g</Text>
      </View>
      <View
        style={styles.xpTrack}
        accessibilityRole="progressbar"
        accessibilityLabel={`XP ${Math.floor(profile.xp)} of ${Math.floor(profile.xp_to_next_level)}`}
      >
        <View style={[styles.xpFill, { flex: xpPct }]} />
        <View style={{ flex: Math.max(0, 1 - xpPct) }} />
      </View>
      <Text style={styles.xpText}>
        XP {Math.floor(profile.xp)}/{Math.floor(profile.xp_to_next_level)}
      </Text>
    </View>
  );
}

export default function GameScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <ProfileHeader />
      <View style={styles.menu}>
        {MENU.map((item) => (
          <Link key={item.title} href={item.href} asChild>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              accessibilityRole="link"
              accessibilityLabel={item.title}
            >
              <SymbolView name={item.icon} tintColor={Colors.accent} size={22} />
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{item.title}</Text>
                <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four },
  profileCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  levelText: { flex: 1, color: Colors.accent, fontSize: 15, fontWeight: '700' },
  chip: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  gold: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  xpTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.backgroundSelected,
    overflow: 'hidden',
  },
  xpFill: { backgroundColor: Colors.accent },
  xpText: { color: Colors.textSecondary, fontSize: 11 },
  profileFallback: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    padding: Spacing.three,
  },
  menu: { gap: Spacing.two },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
  },
  menuRowPressed: { backgroundColor: Colors.backgroundSelected },
  menuText: { flex: 1, gap: 2 },
  menuTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  menuSubtitle: { color: Colors.textSecondary, fontSize: 12 },
  chevron: { color: Colors.textMuted, fontSize: 20, fontWeight: '700' },
});
