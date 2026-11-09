import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import Field from '../components/Field';
import Pagination from '../components/Pagination';

const ROLES = { requester: 'Student / Staff', officer: 'Maintenance Officer', admin: 'Administrator' };

export function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'officer' });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(() => api.users().then((r) => setUsers(r.data)).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.name.trim().length < 2) errs.name = 'Enter a name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email';
    if (form.password.length < 8) errs.password = 'At least 8 characters';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await api.createUser(form);
      toast('User created');
      setForm({ name: '', email: '', password: '', role: 'officer' });
      setShowForm(false);
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const patch = async (u, body, msg) => {
    try { await api.updateUser(u.id, body); toast(msg); load(); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Users</h1><p className="muted">Create officers and administrators, change roles, or disable accounts.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}><UserPlus size={16} aria-hidden /> Add user</button>
      </div>
      {showForm && (
        <form className="card form-card" onSubmit={create} noValidate>
          <div className="grid-2">
            <Field id="u-name" label="Full name" error={errors.name}><input id="u-name" value={form.name} onChange={set('name')} /></Field>
            <Field id="u-email" label="Email" error={errors.email}><input id="u-email" type="email" value={form.email} onChange={set('email')} /></Field>
            <Field id="u-pass" label="Temporary password" error={errors.password}><input id="u-pass" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
            <Field id="u-role" label="Role">
              <select id="u-role" value={form.role} onChange={set('role')}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button><button className="btn btn-primary">Create user</button></div>
        </form>
      )}
      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.email}</td>
                  <td>
                    <select aria-label={`Role for ${u.name}`} value={u.role} disabled={u.id === me.id}
                      onChange={(e) => patch(u, { role: e.target.value }, 'Role updated')}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><span className={`badge ${u.is_active ? 'badge-completed' : 'badge-cancelled'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                  <td className="right">
                    {u.id !== me.id && <button className="btn btn-ghost btn-sm" onClick={() => patch(u, { is_active: !u.is_active }, u.is_active ? 'Account disabled' : 'Account enabled')}>{u.is_active ? 'Disable' : 'Enable'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function AuditLog() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.audit({ page, limit: 15 }).then(setResult).catch((e) => setError(e.message)); }, [page]);

  return (
    <>
      <div className="page-head"><div><h1>Audit log</h1><p className="muted">Every sign-in, assignment and status change is recorded.</p></div></div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>
              {result?.data.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.user_name || 'System'}</td>
                  <td><code>{a.action}</code></td>
                  <td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                  <td>{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination pagination={result?.pagination} onChange={setPage} />
      </div>
    </>
  );
}
