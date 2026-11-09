import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, X } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../toast';
import Field from '../components/Field';

export const MAX_IMAGE = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateRequest(f, file) {
  const e = {};
  if (f.title.trim().length < 5) e.title = 'Title must be at least 5 characters';
  if (f.description.trim().length < 10) e.description = 'Describe the problem in at least 10 characters';
  if (f.location.trim().length < 2) e.location = 'Tell us where the problem is';
  if (!f.category_id) e.category_id = 'Select a category';
  if (file && !IMAGE_TYPES.includes(file.type)) e.image = 'Only JPG, PNG or WebP images are allowed';
  else if (file && file.size > MAX_IMAGE) e.image = 'Image must be 2MB or smaller';
  return e;
}

export default function RequestForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', location: '', category_id: '', priority: 'medium' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.categories().then((r) => setCategories(r.data)).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') return setPreview('');
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async (e) => {
    e.preventDefault();
    const errs = validateRequest(form, file);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const data = new FormData();
    Object.entries(form).forEach(([k, v]) => data.append(k, v.trim ? v.trim() : v));
    if (file) data.append('image', file);
    setBusy(true);
    try {
      const created = await api.createRequest(data);
      toast('Request submitted. You will be notified as it progresses.');
      navigate(`/requests/${created.id}`);
    } catch (err) {
      if (err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head"><div><h1>New service request</h1><p className="muted">Describe the fault so the right officer can fix it quickly.</p></div></div>
      <form className="card form-card" onSubmit={submit} noValidate>
        <Field id="title" label="Title" error={errors.title}>
          <input id="title" value={form.title} onChange={set('title')} placeholder="e.g. Leaking pipe under sink" maxLength={160} aria-invalid={!!errors.title} />
        </Field>
        <div className="grid-2">
          <Field id="category_id" label="Category" error={errors.category_id}>
            <select id="category_id" value={form.category_id} onChange={set('category_id')} aria-invalid={!!errors.category_id}>
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="priority" label="Priority">
            <select id="priority" value={form.priority} onChange={set('priority')}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </Field>
        </div>
        <Field id="location" label="Location" error={errors.location}>
          <input id="location" value={form.location} onChange={set('location')} placeholder="e.g. Hostel B, Room 12" aria-invalid={!!errors.location} />
        </Field>
        <Field id="description" label="Description" error={errors.description}>
          <textarea id="description" rows={5} value={form.description} onChange={set('description')} maxLength={2000} aria-invalid={!!errors.description} />
        </Field>
        <Field id="image" label="Photo evidence (optional)" error={errors.image} hint="JPG, PNG or WebP, up to 2MB">
          <input id="image" ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} className="file-input" onChange={(e) => setFile(e.target.files[0] || null)} />
          <label htmlFor="image" className="btn btn-ghost"><ImagePlus size={16} aria-hidden /> {file ? 'Change photo' : 'Choose photo'}</label>
        </Field>
        {preview && (
          <div className="preview">
            <img src={preview} alt="Selected evidence preview" />
            <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}><X size={16} /></button>
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</button>
        </div>
      </form>
    </>
  );
}
