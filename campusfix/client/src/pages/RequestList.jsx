import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Download, FilePlus2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { StatusBadge, PriorityBadge, STATUS_LABELS } from '../components/Badges';
import Pagination from '../components/Pagination';

const TITLES = { requester: 'My requests', officer: 'Assigned jobs', admin: 'Manage requests' };

export default function RequestList() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState(params.get('search') || '');

  const filters = {
    search: params.get('search') || '',
    status: params.get('status') || '',
    priority: params.get('priority') || '',
    category_id: params.get('category_id') || '',
    page: Number(params.get('page') || 1),
  };

  const update = useCallback((patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  }, [params, setParams]);

  useEffect(() => { api.categories().then((r) => setCategories(r.data)).catch(() => {}); }, []);

  // debounce search typing
  useEffect(() => {
    const t = setTimeout(() => searchText !== filters.search && update({ search: searchText }), 350);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    setError('');
    api.requests({ ...filters, limit: 10 })
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    try {
      const blob = await api.exportCsv({ ...filters, page: '' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'service-requests.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('CSV exported');
    } catch (e) { toast(e.message, 'error'); }
  };

  const hasFilters = filters.search || filters.status || filters.priority || filters.category_id;

  return (
    <>
      <div className="page-head">
        <div><h1>{TITLES[user.role]}</h1><p className="muted">Search, filter and track every request.</p></div>
        <div className="row gap-sm">
          {user.role === 'admin' && <button className="btn btn-ghost" onClick={exportCsv}><Download size={16} aria-hidden /> Export CSV</button>}
          {user.role !== 'officer' && <Link to="/requests/new" className="btn btn-primary"><FilePlus2 size={16} aria-hidden /> New request</Link>}
        </div>
      </div>

      <div className="card filters" role="search">
        <div className="search-box">
          <Search size={16} aria-hidden />
          <input aria-label="Search requests" placeholder="Search title, description or location" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Filter by priority" value={filters.priority} onChange={(e) => update({ priority: e.target.value })}>
          <option value="">All priorities</option>
          {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select aria-label="Filter by category" value={filters.category_id} onChange={(e) => update({ category_id: e.target.value })}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {hasFilters && <button className="link-btn" onClick={() => { setSearchText(''); setParams({}); }}>Clear</button>}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="card table-card" aria-busy={loading}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Request</th><th>Category</th><th>Priority</th><th>Status</th><th>{user.role === 'requester' ? 'Officer' : 'Requester'}</th><th>Submitted</th></tr>
            </thead>
            <tbody>
              {result?.data.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/requests/${r.id}`} className="row-link"><strong>{r.title}</strong><small>{r.location}</small></Link></td>
                  <td>{r.category}</td>
                  <td><PriorityBadge priority={r.priority} /></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{user.role === 'requester' ? r.officer_name || <span className="muted">Not assigned</span> : r.requester_name}</td>
                  <td className="nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && result?.data.length === 0 && (
          <p className="empty">{hasFilters ? 'No requests match your filters.' : user.role === 'officer' ? 'No jobs assigned to you yet.' : 'No requests yet.'}</p>
        )}
        {loading && !result && <p className="empty">Loading requests...</p>}
        <Pagination pagination={result?.pagination} onChange={(page) => update({ page: String(page) })} />
      </div>
    </>
  );
}
