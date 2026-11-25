import axios from 'axios';
const base = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/v1';
export const api = axios.create({ baseURL: base, withCredentials: true });
api.interceptors.response.use(r => { if (r.data?.success) r.data = r.data.data; return r; });
export function errorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) return 'تعذر الاتصال بالخادم. تأكد من تشغيل الباك إند.';
    const d = e.response.data as { message?: string; error?: { message?: string } } | undefined;
    return d?.message || d?.error?.message || 'حدث خطأ.';
  }
  return 'حدث خطأ غير متوقع.';
}
