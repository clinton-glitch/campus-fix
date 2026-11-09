import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../api';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ data: [], unread: 0 });
  const ref = useRef(null);

  const load = useCallback(() => api.notifications().then(setData).catch(() => {}), []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // near real-time: poll every 20s
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const markAll = async () => {
    await api.readAll();
    load();
  };

  return (
    <div className="bell" ref={ref}>
      <button
        className="icon-btn"
        aria-label={`Notifications, ${data.unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={20} />
        {data.unread > 0 && <span className="bell-count">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="popover-head">
            <strong>Notifications</strong>
            <button className="link-btn" onClick={markAll} disabled={!data.unread}>
              Mark all read
            </button>
          </div>
          {data.data.length === 0 && <p className="muted pad">You are all caught up.</p>}
          <ul className="notif-list">
            {data.data.map((n) => (
              <li key={n.id} className={n.is_read ? '' : 'unread'}>
                <Link to={n.request_id ? `/requests/${n.request_id}` : '/'} onClick={() => setOpen(false)}>
                  <span>{n.message}</span>
                  <small>{new Date(n.created_at).toLocaleString()}</small>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
