import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Wrench, Eye, EyeOff } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import Field from '../components/Field';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin({ email, password }) {
  const e = {};
  if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address';
  if (!password) e.password = 'Password is required';
  return e;
}

export function validateRegister({ name, email, password, confirm }) {
  const e = {};
  if (name.trim().length < 2) e.name = 'Enter your full name';
  if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address';
  if (password.length < 8) e.password = 'Use at least 8 characters';
  else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) e.password = 'Include at least one letter and one number';
  if (confirm !== password) e.confirm = 'Passwords do not match';
  return e;
}

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <section className="auth-aside" aria-hidden>
        <div className="brand brand-light">
          <span className="brand-mark"><Wrench size={18} /></span> CampusFix
        </div>
        <h2>Report it once. Track it to done.</h2>
        <p>One place for every maintenance complaint on campus: electricity, plumbing, furniture, internet, classrooms and hostels.</p>
      </section>
      <section className="auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
        <p className="auth-foot">{footer}</p>
      </section>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} aria-invalid={invalid} />
      <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = validateLogin(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      signIn(await api.login({ email: form.email.trim(), password: form.password }));
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your campus account to continue."
      footer={<>New here? <Link to="/register">Create an account</Link></>}
    >
      <form onSubmit={submit} noValidate>
        {formError && <div className="alert alert-error" role="alert">{formError}</div>}
        <Field id="email" label="Email" error={errors.email}>
          <input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" aria-invalid={!!errors.email} />
        </Field>
        <Field id="password" label="Password" error={errors.password}>
          <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="current-password" invalid={!!errors.password} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = validateRegister(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { confirm, ...payload } = form;
      signIn(await api.register({ ...payload, email: payload.email.trim() }));
      navigate('/', { replace: true });
    } catch (err) {
      if (err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="For students and staff. Officers and administrators are added by the admin office."
      footer={<>Already registered? <Link to="/login">Sign in</Link></>}
    >
      <form onSubmit={submit} noValidate>
        {formError && <div className="alert alert-error" role="alert">{formError}</div>}
        <Field id="name" label="Full name" error={errors.name}>
          <input id="name" value={form.name} onChange={set('name')} autoComplete="name" aria-invalid={!!errors.name} />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" aria-invalid={!!errors.email} />
        </Field>
        <Field id="phone" label="Phone (optional)" error={errors.phone}>
          <input id="phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
        </Field>
        <Field id="password" label="Password" error={errors.password} hint="At least 8 characters with a letter and a number">
          <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="new-password" invalid={!!errors.password} />
        </Field>
        <Field id="confirm" label="Confirm password" error={errors.confirm}>
          <PasswordInput id="confirm" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" invalid={!!errors.confirm} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}
