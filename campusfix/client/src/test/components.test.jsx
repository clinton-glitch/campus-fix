import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: {
    login: vi.fn(),
    register: vi.fn(),
    categories: vi.fn(),
    requests: vi.fn(),
    createRequest: vi.fn(),
    notifications: vi.fn(),
  },
  tokenStore: { get: () => null, set: () => {}, clear: () => {} },
}));

import { api } from '../api';
import { AuthProvider } from '../auth';
import { ToastProvider } from '../toast';
import { Login, Register, validateLogin, validateRegister } from '../pages/AuthPages';
import RequestForm, { validateRequest, MAX_IMAGE } from '../pages/RequestForm';
import RequestList from '../pages/RequestList';
import { StatusBadge, PriorityBadge } from '../components/Badges';
import Pagination from '../components/Pagination';
import ProtectedRoute from '../components/ProtectedRoute';
import { navFor } from '../components/Layout';
import * as authModule from '../auth';

const wrap = (ui, route = '/') => render(
  <MemoryRouter initialEntries={[route]}>
    <AuthProvider><ToastProvider>{ui}</ToastProvider></AuthProvider>
  </MemoryRouter>
);

beforeEach(() => vi.clearAllMocks());

describe('form validators', () => {
  test('login: flags bad email and missing password', () => {
    expect(validateLogin({ email: 'nope', password: '' })).toEqual({
      email: 'Enter a valid email address',
      password: 'Password is required',
    });
    expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
  });

  test('register: password rules and confirmation match', () => {
    const base = { name: 'Ada Obi', email: 'ada@b.co', password: 'Secret123', confirm: 'Secret123' };
    expect(validateRegister(base)).toEqual({});
    expect(validateRegister({ ...base, password: 'short', confirm: 'short' }).password).toMatch(/8 characters/);
    expect(validateRegister({ ...base, password: 'abcdefgh', confirm: 'abcdefgh' }).password).toMatch(/letter and one number/);
    expect(validateRegister({ ...base, confirm: 'different1' }).confirm).toMatch(/do not match/);
  });

  test('request: required fields and image rules', () => {
    const empty = validateRequest({ title: '', description: '', location: '', category_id: '' }, null);
    expect(Object.keys(empty).sort()).toEqual(['category_id', 'description', 'location', 'title']);
    const ok = { title: 'Broken chair', description: 'The chair leg snapped off', location: 'LT1', category_id: '2' };
    expect(validateRequest(ok, null)).toEqual({});
    expect(validateRequest(ok, { type: 'application/pdf', size: 10 }).image).toMatch(/JPG, PNG or WebP/);
    expect(validateRequest(ok, { type: 'image/png', size: MAX_IMAGE + 1 }).image).toMatch(/2MB/);
  });
});

describe('Login page', () => {
  test('shows validation errors and does not call the API on an empty submit', async () => {
    wrap(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  test('submits trimmed credentials to the API', async () => {
    api.login.mockResolvedValue({ token: 't', user: { id: 1, name: 'A', role: 'requester' } });
    wrap(<Login />);
    await userEvent.type(screen.getByLabelText('Email'), ' student@campusfix.test ');
    await userEvent.type(screen.getByLabelText('Password'), 'Student@123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.login).toHaveBeenCalledWith({ email: 'student@campusfix.test', password: 'Student@123' }));
  });

  test('displays the server error message on failed login', async () => {
    api.login.mockRejectedValue(new Error('Invalid email or password'));
    wrap(<Login />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  test('password visibility toggle works', async () => {
    wrap(<Login />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});

describe('Register page', () => {
  test('blocks mismatched passwords', async () => {
    wrap(<Register />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Ada Obi');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Secret124');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });
});

describe('Request submission form', () => {
  beforeEach(() => api.categories.mockResolvedValue({ data: [{ id: 1, name: 'Electricity' }, { id: 3, name: 'Plumbing' }] }));

  test('loads categories and blocks an incomplete submit', async () => {
    wrap(<RequestForm />);
    expect(await screen.findByRole('option', { name: 'Plumbing' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Select a category')).toBeInTheDocument();
    expect(screen.getByText('Title must be at least 5 characters')).toBeInTheDocument();
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  test('sends a multipart FormData payload when valid', async () => {
    api.createRequest.mockResolvedValue({ id: 7 });
    wrap(<RequestForm />);
    await screen.findByRole('option', { name: 'Plumbing' });
    await userEvent.type(screen.getByLabelText('Title'), 'Leaking pipe in hostel');
    await userEvent.selectOptions(screen.getByLabelText('Category'), '3');
    await userEvent.type(screen.getByLabelText('Location'), 'Hostel B Room 12');
    await userEvent.type(screen.getByLabelText('Description'), 'Water is leaking under the sink');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    const fd = api.createRequest.mock.calls[0][0];
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get('title')).toBe('Leaking pipe in hostel');
    expect(fd.get('category_id')).toBe('3');
    expect(fd.get('priority')).toBe('medium');
  });
});

describe('Request tracking list', () => {
  const user = { id: 1, name: 'Ada', role: 'requester' };
  const result = {
    data: [
      { id: 1, title: 'Broken socket', location: 'Lab 1', category: 'Electricity', priority: 'high', status: 'assigned', officer_name: 'Musa', requester_name: 'Ada', created_at: '2026-11-01T10:00:00Z' },
      { id: 2, title: 'Leaking tap', location: 'Hostel A', category: 'Plumbing', priority: 'low', status: 'pending', officer_name: null, requester_name: 'Ada', created_at: '2026-11-02T10:00:00Z' },
    ],
    pagination: { page: 1, limit: 10, total: 2, pages: 1 },
  };

  beforeEach(() => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue({ user });
    api.categories.mockResolvedValue({ data: [{ id: 1, name: 'Electricity' }] });
    api.requests.mockResolvedValue(result);
  });
  afterEach(() => vi.restoreAllMocks());

  test('renders rows with status badges and unassigned placeholder', async () => {
    wrap(<RequestList />);
    expect(await screen.findByText('Broken socket')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Assigned')).toHaveClass('badge-assigned');
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    expect(screen.getByText('Showing 1-2 of 2')).toBeInTheDocument();
  });

  test('changing the status filter re-queries the API with that filter', async () => {
    wrap(<RequestList />);
    await screen.findByText('Broken socket');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'pending');
    await waitFor(() => expect(api.requests).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending' })));
  });

  test('shows an empty state when nothing matches', async () => {
    api.requests.mockResolvedValue({ data: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } });
    wrap(<RequestList />, '/requests?status=completed');
    expect(await screen.findByText('No requests match your filters.')).toBeInTheDocument();
  });
});

describe('Shared components', () => {
  test('badges show human readable labels', () => {
    render(<><StatusBadge status="in_progress" /><PriorityBadge priority="urgent" /></>);
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('urgent')).toHaveClass('prio-urgent');
  });

  test('pagination disables edges and emits page changes', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination pagination={{ page: 1, pages: 3, total: 25, limit: 10 }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenCalledWith(2);
    rerender(<Pagination pagination={{ page: 3, pages: 3, total: 25, limit: 10 }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  test('navigation menu differs per role', () => {
    const labels = (r) => navFor(r).map((i) => i.label);
    expect(labels('requester')).toContain('New request');
    expect(labels('requester')).not.toContain('Users');
    expect(labels('officer')).toEqual(['Dashboard', 'Assigned jobs']);
    expect(labels('admin')).toEqual(expect.arrayContaining(['Users', 'Audit log', 'Manage requests']));
  });
});

describe('Route protection', () => {
  const tree = (
    <Routes>
      <Route path="/login" element={<div>Login screen</div>} />
      <Route path="/" element={<div>Home</div>} />
      <Route element={<ProtectedRoute roles={['admin']} />}>
        <Route path="/admin" element={<div>Admin area</div>} />
      </Route>
    </Routes>
  );

  test('redirects anonymous visitors to /login', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue({ user: null, loading: false });
    render(<MemoryRouter initialEntries={['/admin']}>{tree}</MemoryRouter>);
    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });

  test('redirects a student away from admin pages', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue({ user: { role: 'requester' }, loading: false });
    render(<MemoryRouter initialEntries={['/admin']}>{tree}</MemoryRouter>);
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  test('lets an admin in', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue({ user: { role: 'admin' }, loading: false });
    render(<MemoryRouter initialEntries={['/admin']}>{tree}</MemoryRouter>);
    expect(screen.getByText('Admin area')).toBeInTheDocument();
  });
});
