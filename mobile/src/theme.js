import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- Themes. `C` and `SH` are mutated in place by applyTheme(), so every screen that reads them while rendering picks up the new look.
export const LIGHT = { bg: '#F4F1EA', card: '#fff', ink: '#141B22', mute: '#5F666B', line: '#E4DFD3', brand: '#0E5A52', soft: '#DFEEE3', ok: '#1E6B3F', bad: '#C23B32', warn: '#B76E0A', info: '#2F58B5', side: '#14202A', sideOn: '#2B363F', blueSoft: '#DCE8F8',
  okBg: '#dcfce7', badBg: '#fee2e2', warnBg: '#fef3c7', infoBg: '#dbeafe', muteBg: '#EFEBE2', badLine: '#f5c6c2', skel: '#E2DDD0', hint: '#9A9A93', scrim: '#0006', shadow: '#14202A', shadowOpacity: 0.07 };
export const DARK = { bg: '#11181E', card: '#1A242C', ink: '#E8ECEF', mute: '#9AA5AE', line: '#2A363F', brand: '#23978A', soft: '#1E3A36', ok: '#4CC38A', bad: '#F0716A', warn: '#E0A33A', info: '#7BA2F5', side: '#0C1217', sideOn: '#2B363F', blueSoft: '#1F3354',
  okBg: '#173326', badBg: '#3D1D1B', warnBg: '#3A2D12', infoBg: '#1B2B4A', muteBg: '#25303A', badLine: '#6B2F2B', skel: '#2A363F', hint: '#6F7B85', scrim: '#000A', shadow: '#000', shadowOpacity: 0.35 };
export const C = { ...LIGHT };
// soft card shadow used on every white surface
export const SH = { shadowColor: '#14202A', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 };

// styles that are built once at load must still follow the theme: wrap the factory in live() and every property read re-runs it
// Object.freeze matters: React Native's dev mode (Expo Go) deep-freezes style objects by redefining their properties, which throws
// "property is not configurable" on our getters. It skips objects that are already frozen, and frozen getters still compute live.
export const live = (fn) => { const o = {}; for (const k of Object.keys(fn())) Object.defineProperty(o, k, { enumerable: true, get: () => fn()[k] }); return Object.freeze(o); };

// mode: 'system' | 'light' | 'dark'
export const THEME_KEY = 'theme.mode';
export const resolveTheme = (mode) => (mode === 'dark' ? 'dark' : 'light');
export function applyTheme(mode) {
  const t = resolveTheme(mode);
  Object.assign(C, t === 'dark' ? DARK : LIGHT);
  SH.shadowColor = C.shadow; SH.shadowOpacity = C.shadowOpacity;
  return t;
}
export const loadThemeMode = async () => { try { const v = await AsyncStorage.getItem(THEME_KEY); return v === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
export const saveThemeMode = (m) => AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmt = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
export const span = (x) => (x.start_date === x.end_date ? fmt(x.start_date) : `${fmt(x.start_date)} to ${fmt(x.end_date)}`);
export const monthName = (p) => { const [y, m] = p.slice(0, 7).split('-').map(Number); return `${MON[m - 1]} ${y}`; };
export const shiftMonth = (p, n) => { const [y, m] = p.split('-').map(Number); return ym(new Date(y, m - 1 + n, 1)); };
export const prevMonth = () => shiftMonth(ym(new Date()), -1);
export const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
export const ROLE_LABEL = { super_admin: 'Super admin', school_admin: 'School admin', parent: 'Parent', staff: 'Staff', student: 'Student', other: 'Other' };
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
// date/time helpers that don't depend on Intl support
export const timeStr = (iso) => { const d = new Date(iso); let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0'); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m} ${ap}`; };
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayKey = (iso) => new Date(iso).toDateString();
export const dayLabel = (iso) => { const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : `${DAY[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
export const when = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? timeStr(iso) : `${d.getDate()} ${MON[d.getMonth()]}`; };
export const dateTime = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${timeStr(iso)}`; };
