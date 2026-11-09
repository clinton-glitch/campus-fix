import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, UserCheck, Hammer, CheckCircle2, FilePlus2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { StatusBadge, PriorityBadge } from '../components/Badges';

const CARDS = [
  { key: 'pending', label: 'Pending', icon: Clock },
  { key: 'assigned', label: 'Assigned', icon: UserCheck },
  { key: 'in_progress', label: 'In progress', icon: Hammer },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
];

const TITLES = {
  requester: 'Your requests at a glance',
  officer: 'Your assigned jobs',
  admin: 'Campus maintenance overview',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.stats(), api.requests({ limit: 5 })])
      .then(([s, r]) => {
        setStats(s);
        setRecent(r.data);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!stats) return <div className="skeleton-grid" aria-busy="true">{CARDS.map((c) => <div key={c.key} className="skeleton" />)}</div>;

  const maxCat = Math.max(1, ...(stats.byCategory || []).map((c) => c.count));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{TITLES[user.role]}</h1>
          <p className="muted">Hello, {user.name.split(' ')[0]}. {stats.total} request{stats.total === 1 ? '' : 's'} in total.</p>
        </div>
        {user.role !== 'officer' && (
          <Link to="/requests/new" className="btn btn-primary"><FilePlus2 size={16} aria-hidden /> New request</Link>
        )}
      </div>

      <div className="stat-grid">
        {CARDS.map(({ key, label, icon: Icon }) => (
          <Link to={`/requests?status=${key}`} key={key} className={`stat stat-${key}`}>
            <span className="stat-icon"><Icon size={20} aria-hidden /></span>
            <span className="stat-num">{stats.byStatus[key]}</span>
            <span className="stat-label">{label}</span>
          </Link>
        ))}
      </div>

      <div className={user.role === 'admin' ? 'two-col' : ''}>
        <section className="card">
          <div className="card-head">
            <h2>Recent requests</h2>
            <Link to="/requests" className="link-btn">View all</Link>
          </div>
          {recent?.length === 0 && (
            <p className="empty">
              {user.role === 'officer' ? 'No jobs have been assigned to you yet.' : 'No requests yet. Submit your first one to get started.'}
            </p>
          )}
          <ul className="mini-list">
            {recent?.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`}>
                  <div>
                    <strong>{r.title}</strong>
                    <small>{r.category} - {r.location}</small>
                  </div>
                  <div className="row gap-sm"><PriorityBadge priority={r.priority} /><StatusBadge status={r.status} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {user.role === 'admin' && (
          <section className="card">
            <div className="card-head"><h2>Requests by category</h2></div>
            <ul className="bars">
              {stats.byCategory.map((c) => (
                <li key={c.name}>
                  <span className="bar-label">{c.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(c.count / maxCat) * 100}%` }} /></span>
                  <span className="bar-num">{c.count}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Average resolution time: {stats.avgResolutionHours === null ? 'no completed jobs yet' : `${stats.avgResolutionHours} hours`}
            </p>
          </section>
        )}
      </div>
    </>
  );
}
