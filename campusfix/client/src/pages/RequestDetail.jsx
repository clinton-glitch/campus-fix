import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, User, Tag, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { StatusBadge, PriorityBadge, STATUS_LABELS } from '../components/Badges';

const NEXT_FOR_OFFICER = { assigned: ['in_progress'], in_progress: ['completed'] };
const ACTION_LABEL = { in_progress: 'Start work', completed: 'Mark as completed' };

export default function RequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [req, setReq] = useState(null);
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  const [officers, setOfficers] = useState([]);
  const [officerId, setOfficerId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.request(id).then(setReq).catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!req?.has_attachment) return;
    let url;
    api.attachmentBlob(req.id).then((b) => { url = URL.createObjectURL(b); setImage(url); }).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [req?.id, req?.has_attachment]);

  useEffect(() => {
    if (user.role === 'admin') api.users('officer').then((r) => setOfficers(r.data.filter((o) => o.is_active))).catch(() => {});
  }, [user.role]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg);
      setNote('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (error) return (<><Link to="/requests" className="back"><ArrowLeft size={16} /> Back</Link><div className="alert alert-error" role="alert">{error}</div></>);
  if (!req) return <div className="skeleton" style={{ height: 260 }} aria-busy="true" />;

  const open = !['completed', 'cancelled'].includes(req.status);
  const officerActions = user.role === 'officer' ? NEXT_FOR_OFFICER[req.status] || [] : [];
  const canCancel = user.role === 'requester' && req.status === 'pending';
  const canDelete = (user.role === 'requester' && req.status === 'pending') || user.role === 'admin';

  const remove = async () => {
    if (!window.confirm('Delete this request permanently?')) return;
    try { await api.deleteRequest(req.id); toast('Request deleted'); navigate('/requests'); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <Link to="/requests" className="back"><ArrowLeft size={16} aria-hidden /> Back to requests</Link>
      <div className="detail-grid">
        <section className="card">
          <div className="row between wrap gap-sm">
            <h1 className="detail-title">{req.title}</h1>
            <div className="row gap-sm"><PriorityBadge priority={req.priority} /><StatusBadge status={req.status} /></div>
          </div>
          <ul className="meta">
            <li><Tag size={15} aria-hidden /> {req.category}</li>
            <li><MapPin size={15} aria-hidden /> {req.location}</li>
            <li><User size={15} aria-hidden /> Requested by {req.requester_name}</li>
          </ul>
          <p className="desc">{req.description}</p>
          {image && <a href={image} target="_blank" rel="noreferrer"><img className="evidence" src={image} alt="Evidence of the reported fault" /></a>}
          <p className="muted small">
            Submitted {new Date(req.created_at).toLocaleString()}
            {req.completed_at && <> - Completed {new Date(req.completed_at).toLocaleString()}</>}
          </p>
        </section>

        <aside className="stack">
          <section className="card">
            <h2>Assignment</h2>
            <p>{req.officer_name ? <>Assigned to <strong>{req.officer_name}</strong></> : <span className="muted">Not assigned yet</span>}</p>
            {user.role === 'admin' && open && (
              <div className="assign">
                <label htmlFor="officer" className="sr-only">Maintenance officer</label>
                <select id="officer" value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
                  <option value="">Select officer</option>
                  {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button className="btn btn-primary" disabled={!officerId || busy}
                  onClick={() => run(() => api.assign(req.id, Number(officerId)), 'Request assigned')}>
                  {req.officer_name ? 'Reassign' : 'Assign'}
                </button>
              </div>
            )}
          </section>

          {(officerActions.length > 0 || canCancel || (user.role === 'admin' && open)) && (
            <section className="card">
              <h2>Update progress</h2>
              <label htmlFor="note" className="sr-only">Progress note</label>
              <textarea id="note" rows={3} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <div className="row gap-sm wrap">
                {officerActions.map((s) => (
                  <button key={s} className="btn btn-primary" disabled={busy} onClick={() => run(() => api.setStatus(req.id, s, note), `Marked ${STATUS_LABELS[s].toLowerCase()}`)}>{ACTION_LABEL[s]}</button>
                ))}
                {user.role === 'admin' && open && ['in_progress', 'completed', 'cancelled'].filter((s) => s !== req.status).map((s) => (
                  <button key={s} className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.setStatus(req.id, s, note), `Marked ${STATUS_LABELS[s].toLowerCase()}`)}>{STATUS_LABELS[s]}</button>
                ))}
                {canCancel && <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.setStatus(req.id, 'cancelled', note), 'Request cancelled')}>Cancel request</button>}
              </div>
            </section>
          )}

          <section className="card">
            <h2>Status timeline</h2>
            <ol className="timeline">
              {req.timeline.map((t) => (
                <li key={t.id}>
                  <span className="dot" aria-hidden />
                  <div>
                    <strong>{STATUS_LABELS[t.new_status]}</strong>
                    <small>{new Date(t.created_at).toLocaleString()} - {t.changed_by}</small>
                    {t.note && <p>{t.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
          {canDelete && <button className="btn btn-danger" onClick={remove}><Trash2 size={16} aria-hidden /> Delete request</button>}
        </aside>
      </div>
    </>
  );
}
