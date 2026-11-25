import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
export interface User { id: number; fullName: string; email: string; username?: string; roles: string[]; status: 'PENDING' | 'ACTIVE' | 'REJECTED'; stageId: number | null; stage: { id: number; name: string; slug: string } | null }
interface Ctx { user: User | null; loading: boolean; login: (identifier: string, password: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<unknown>; setUser: (u: User) => void }
const C = createContext<Ctx>(null!); export const useAuth = () => useContext(C);
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], retry: false, staleTime: 60_000, queryFn: async () => (await api.get<{ user: User }>('/auth/me')).data.user });
  const value: Ctx = {
    user: me.data ?? null, loading: me.isLoading, refresh: () => qc.refetchQueries({ queryKey: ['me'] }), setUser: u => qc.setQueryData(['me'], u),
    // Set the user directly from the login response instead of relying on a refetch:
    // refetchQueries can silently no-op right after a fresh page load, leaving the UI stuck.
    login: async (identifier, password) => { const { data } = await api.post<{ user: User }>('/auth/login', { identifier, password }); qc.setQueryData(['me'], data.user); qc.removeQueries({ predicate: q => q.queryKey[0] !== 'me' }); }, // مسح بيانات المستخدم السابق بدل إظهارها مؤقتًا
    // Same fix as login: set the query data directly instead of qc.clear() first —
    // clearing the cache resets the mounted 'me' observer and can swallow the null update,
    // leaving the route guard never seeing the logged-out state (stuck on /app).
    logout: async () => { await api.post('/auth/logout').catch(() => undefined); qc.setQueryData(['me'], null); qc.invalidateQueries({ predicate: q => q.queryKey[0] !== 'me' }); qc.removeQueries({ predicate: q => q.queryKey[0] !== 'me' }); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
