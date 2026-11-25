export const ROLE_LABEL: Record<string, string> = { ADMIN: 'أمين الخدمة', SUPERVISOR: 'مشرف مرحلة', ASSISTANT: 'مشرف مساعد', SERVANT: 'خادم', STOREKEEPER: 'خادم المخزن', ATTENDANCE: 'خادم الغياب' };
// الرتب التي يمنحها الأدمن عند الموافقة على الخادم (المشرف المساعد بنفس صلاحيات مشرف المرحلة)
export const ROLE_CHOICES: { role: string; label: string; needsStage: boolean; hint: string }[] = [
  { role: 'SUPERVISOR', label: 'مشرف مرحلة', needsStage: true, hint: 'يرى مرحلته: الخدام والحضور والتحضير' },
  { role: 'ASSISTANT', label: 'مشرف مساعد', needsStage: true, hint: 'بنفس صلاحيات مشرف المرحلة' },
  { role: 'SERVANT', label: 'خادم', needsStage: true, hint: 'يرفع تحضيره ويطلب من المخزن' },
  { role: 'STOREKEEPER', label: 'خادم المخزن', needsStage: false, hint: 'يدير المخزن ويراجع الطلبات' },
  { role: 'ATTENDANCE', label: 'خادم الغياب', needsStage: false, hint: 'صفحة الحضور والغياب لكل المراحل فقط' },
];
export const ASSIGNABLE = ['SUPERVISOR', 'ASSISTANT', 'SERVANT', 'STOREKEEPER', 'ATTENDANCE'];
type N = [string, string][];
const SUP: N = [['', 'الرئيسية'], ['servants', 'الخدام'], ['members', 'مخدومو المرحلة'], ['distribution', 'توزيع المخدومين'], ['attendance', 'الحضور والغياب'], ['lessons', 'دروس الشهر'], ['followups', 'الافتقاد'], ['warehouse', 'المخزن'], ['warehouse-requests', 'طلباتي'], ['notifications', 'الإشعارات']];
export const NAV: Record<string, N> = {
  ADMIN: [['', 'الرئيسية'], ['preparations', 'تحضيرك'], ['registrations', 'طلبات التسجيل'], ['users', 'المستخدمون'], ['stages', 'المراحل'], ['attendance', 'الحضور والغياب'], ['followups', 'الافتقاد'], ['confession', 'الاعتراف'], ['warehouse', 'المخزن (قراءة)'], ['warehouse-requests', 'طلبات المخزن'], ['settings', 'الإعدادات']],
  SUPERVISOR: [...SUP.slice(0, 1), ['preparations', 'تحضيرك'], ['users', 'الخدام'], ...SUP.slice(2)],
  ASSISTANT: [...SUP.slice(0, 1), ['preparations', 'تحضيرك'], ['users', 'الخدام'], ...SUP.slice(2)],
  // Every servant can view warehouse products and submit stock requests for their stage — not just supervisor/assistant.
  SERVANT: [['', 'الرئيسية'], ['preparations', 'تحضيرك'], ['members', 'مخدومي'], ['attendance', 'الحضور'], ['followups', 'الافتقاد'], ['warehouse', 'المخزن'], ['warehouse-requests', 'طلباتي'], ['notifications', 'الإشعارات'], ['profile', 'الملف الشخصي']],
  STOREKEEPER: [['warehouse', 'المخزن'], ['warehouse-requests', 'طلبات المخزن']],
  ATTENDANCE: [['attendance', 'الحضور والغياب']],
};
export const navFor = (roles: string[]): N => { const seen = new Set<string>(); return ['ADMIN', 'SUPERVISOR', 'ASSISTANT', 'SERVANT', 'STOREKEEPER', 'ATTENDANCE'].filter(r => roles.includes(r)).flatMap(r => NAV[r]).filter(([p]) => !seen.has(p) && seen.add(p)); };
export const STAGE_ICON: Record<string, string> = { kg: '☀️', 'g1-2': '🌱', 'g3-4': '🎈', 'g5-6': '🚀', 'prep-boys': '⚓', 'prep-girls': '🌸', 'sec-boys': '🛡️', 'sec-girls': '🦋' };
export const NAV_ICON: Record<string, string> = {
  '': 'LayoutDashboard', registrations: 'UserPlus', users: 'Users', stages: 'Layers', attendance: 'CalendarCheck', followups: 'HeartHandshake',
  confession: 'BookOpenCheck', warehouse: 'Warehouse', settings: 'Settings', servants: 'UserCog',
  members: 'Users2', distribution: 'Shuffle', lessons: 'BookOpen', notifications: 'Bell', profile: 'UserCircle2',
  'warehouse-requests': 'ClipboardList', 'servants-attendance': 'CalendarCheck2', mass: 'Church', meetings: 'Users', preparations: 'Images',
};
