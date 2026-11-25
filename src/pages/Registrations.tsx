import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, UserPlus, X } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { ROLE_CHOICES } from '../roles';
import { STAGE_ICON } from '../roles';
import { initial } from '../components/ui';

interface Reg { id: string; fullName: string; email: string; username: string | null; createdAt: string }
interface StageOpt { id: number; slug: string; name: string; order?: number | null }

function RegCard({ r, stages }: { r: Reg; stages: StageOpt[] }) {
  const qc = useQueryClient();
  const [role, setRole] = useState('SERVANT');
  const [stageId, setStageId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const choice = ROLE_CHOICES.find(c => c.role === role)!;
  const stage = stages.find(s => String(s.id) === stageId);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['registrations'] }); qc.invalidateQueries({ queryKey: ['dash-pending'] }); };

  const approve = useMutation({
    mutationFn: async () => { await api.post(`/registrations/${r.id}/approve`, { roles: [role], stageId: choice.needsStage ? Number(stageId) : undefined }); },
    onSuccess: refresh, onError: e => setErr(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: async () => { await api.post(`/registrations/${r.id}/reject`, {}); },
    onSuccess: refresh, onError: e => setErr(errorMessage(e)),
  });

  const ready = !choice.needsStage || !!stageId;
  const preview = `${choice.label}${choice.needsStage && stage ? ` — ${stage.name}` : ''}`;

  return (
    <article className="reg-card">
      <header>
        <span className="vav lg">{initial(r.fullName)}</span>
        <div><b>{r.fullName}</b><small>{r.email}{r.username ? ` · @${r.username}` : ''}</small></div>
        <span className="reg-new">جديد</span>
      </header>

      <div className="reg-roles" role="radiogroup" aria-label="الرتبة">
        {ROLE_CHOICES.map(c => (
          <button key={c.role} role="radio" aria-checked={role === c.role} className={`reg-role${role === c.role ? ' on' : ''}`} onClick={() => { setRole(c.role); setErr(null); }}>
            <b>{c.label}</b><small>{c.hint}</small>
          </button>
        ))}
      </div>

      {choice.needsStage && (
        <div className="reg-stages" role="radiogroup" aria-label="المرحلة">
          {stages.map(s => (
            <button key={s.id} role="radio" aria-checked={stageId === String(s.id)} data-stage={s.slug} className={`reg-stage${stageId === String(s.id) ? ' on' : ''}`} onClick={() => { setStageId(String(s.id)); setErr(null); }}>
              <span aria-hidden>{STAGE_ICON[s.slug] ?? '📘'}</span>{s.name}
            </button>
          ))}
        </div>
      )}

      {err && <div className="err">{err}</div>}
      <footer>
        <span className="reg-preview">{ready ? <>هيتسجّل كـ: <b>{preview}</b></> : 'اختار المرحلة الأول'}</span>
        <div className="reg-actions">
          <button className="btn" disabled={!ready || approve.isPending || reject.isPending} onClick={() => approve.mutate()}><Check size={16} /> {approve.isPending ? 'جارٍ…' : 'موافقة'}</button>
          <button className="btn btn--ghost" disabled={approve.isPending || reject.isPending} onClick={() => { if (window.confirm(`رفض طلب ${r.fullName}؟`)) reject.mutate(); }}><X size={16} /> رفض</button>
        </div>
      </footer>
    </article>
  );
}

export default function Registrations() {
  const list = useQuery({ queryKey: ['registrations'], queryFn: async () => (await api.get<{ registrations: Reg[] }>('/registrations')).data.registrations });
  const stages = useQuery({ queryKey: ['stages-opts'], queryFn: async () => (await api.get<{ stages: StageOpt[] }>('/stages')).data.stages, staleTime: 5 * 60_000 });
  const opts = [...(stages.data ?? [])].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
  const items = list.data ?? [];

  return (
    <>
      <div className="page-head"><h2>طلبات التسجيل</h2><span className="page-head-orn" aria-hidden /></div>
      <p className="prep-lead">وافق على الخادم وحدد رتبته ومرحلته في نفس الخطوة.</p>
      {list.isError && <div className="err">{errorMessage(list.error)}</div>}
      {list.isLoading && <p>جارٍ التحميل…</p>}
      {!list.isLoading && items.length === 0 && <div className="prep-empty"><UserPlus size={30} /><p>مفيش طلبات تسجيل جديدة.</p></div>}
      <div className="reg-list vstagger">{items.map(r => <RegCard key={r.id} r={r} stages={opts} />)}</div>
    </>
  );
}
