// الأدوار في الموقع (مصدر واحد للحقيقة)
export const ALL_ROLES = ['ADMIN', 'SUPERVISOR', 'ASSISTANT', 'SERVANT', 'STOREKEEPER', 'ATTENDANCE'];

// أدوار مرتبطة بمرحلة (يجب تحديد المرحلة عند منحها)
export const STAGE_ROLES = ['SUPERVISOR', 'ASSISTANT', 'SERVANT'];

export const has = (user, role) => (user.roles || []).includes(role);
export const isAdmin = user => has(user, 'ADMIN');
// مشرف المرحلة والمشرف المساعد لهما نفس الصلاحيات
export const isLead = user => has(user, 'SUPERVISOR') || has(user, 'ASSISTANT');
export const isKeeper = user => has(user, 'STOREKEEPER');
export const isAttendanceKeeper = user => has(user, 'ATTENDANCE');

/** يتحقق من الأدوار والمرحلة المطلوبة معًا. يرجع { roles, stageId } أو { error }. */
export function validateRolesAndStage(rolesInput, stageInput, stageExists) {
  if (!Array.isArray(rolesInput) || rolesInput.length === 0 ||
      rolesInput.some(r => !ALL_ROLES.includes(r)) || new Set(rolesInput).size !== rolesInput.length) {
    return Promise.resolve({ error: 'الأدوار المختارة غير صحيحة.' });
  }

  const needsStage = rolesInput.some(r => STAGE_ROLES.includes(r));
  const empty = stageInput === undefined || stageInput === null || stageInput === '';

  if (!needsStage) return Promise.resolve({ roles: rolesInput, stageId: null });
  if (empty) return Promise.resolve({ error: 'اختار المرحلة لهذا الدور.' });

  const stageId = Number(stageInput);
  if (!Number.isInteger(stageId)) return Promise.resolve({ error: 'المرحلة المختارة غير صحيحة.' });

  return stageExists(stageId).then(ok => (ok ? { roles: rolesInput, stageId } : { error: 'المرحلة المختارة غير موجودة.' }));
}
