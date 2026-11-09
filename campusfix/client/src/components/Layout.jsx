import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FilePlus2, ListChecks, Users, ScrollText, LogOut, Wrench, Menu, X } from 'lucide-react';
import { useAuth } from '../auth';
import NotificationBell from './NotificationBell';

const ROLE_LABEL = { requester: 'Student / Staff', officer: 'Maintenance Officer', admin: 'Administrator' };

export function navFor(role) {
  const items = [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }];
  if (role === 'requester') {
    items.push({ to: '/requests/new', label: 'New request', icon: FilePlus2 });
    items.push({ to: '/requests', label: 'My requests', icon: ListChecks, end: true });
  }
  if (role === 'officer') items.push({ to: '/requests', label: 'Assigned jobs', icon: ListChecks, end: true });
  if (role === 'admin') {
    items.push({ to: '/requests', label: 'Manage requests', icon: ListChecks, end: true });
    items.push({ to: '/requests/new', label: 'New request', icon: FilePlus2 });
    items.push({ to: '/admin/users', label: 'Users', icon: Users });
    items.push({ to: '/admin/audit', label: 'Audit log', icon: ScrollText });
  }
  return items;
}

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const logout = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><Wrench size={18} aria-hidden /></span>
          <span>CampusFix</span>
        </div>
        <nav aria-label="Main navigation">
          {navFor(user.role).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to + label} to={to} end={end} onClick={() => setOpen(false)} className="nav-link">
              <Icon size={18} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <strong>{user.name}</strong>
            <small>{ROLE_LABEL[user.role]}</small>
          </div>
          <button className="btn btn-ghost btn-block" onClick={logout}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Toggle menu" onClick={() => setOpen((o) => !o)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="topbar-title">University Maintenance Portal</div>
          <NotificationBell />
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
