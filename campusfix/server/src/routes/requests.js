const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { query, pool } = require('../db/pool');
const config = require('../config');
const { ApiError, asyncHandler, validate } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit, notify, notifyAdmins } = require('../services');

const router = express.Router();
router.use(authenticate);

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) =>
    ALLOWED_MIME.includes(file.mimetype)
      ? cb(null, true)
      : cb(new ApiError(400, 'Only JPG, PNG or WebP images are allowed')),
});

const createSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(160),
  description: z.string().trim().min(10, 'Please describe the problem (10+ characters)').max(2000),
  location: z.string().trim().min(2, 'Location is required').max(160),
  category_id: z.coerce.number().int().positive('Select a category'),
  priority: z.enum(PRIORITIES).default('medium'),
});
const updateSchema = createSchema.partial();

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  category_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(500).optional(),
});
const assignSchema = z.object({ officer_id: z.coerce.number().int().positive() });

const SELECT = `
  SELECT sr.id, sr.title, sr.description, sr.location, sr.priority, sr.status,
         sr.category_id, c.name AS category, sr.requester_id, u.name AS requester_name,
         u.email AS requester_email, a.officer_id, o.name AS officer_name,
         EXISTS (SELECT 1 FROM attachments at WHERE at.request_id = sr.id) AS has_attachment,
         sr.created_at, sr.updated_at, sr.completed_at
  FROM service_requests sr
  JOIN categories c ON c.id = sr.category_id
  JOIN users u ON u.id = sr.requester_id
  LEFT JOIN assignments a ON a.request_id = sr.id AND a.is_active
  LEFT JOIN users o ON o.id = a.officer_id`;

/** Builds a WHERE clause that scopes rows by role and applies the filters. */
function buildWhere(user, f) {
  const where = [];
  const params = [];
  const add = (sql, val) => {
    params.push(val);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (user.role === 'requester') add('sr.requester_id = ?', user.id);
  if (user.role === 'officer') add('a.officer_id = ?', user.id);
  if (f.status) add('sr.status = ?', f.status);
  if (f.priority) add('sr.priority = ?', f.priority);
  if (f.category_id) add('sr.category_id = ?', f.category_id);
  if (f.search) {
    params.push(`%${f.search}%`);
    const n = params.length;
    where.push(`(sr.title ILIKE $${n} OR sr.description ILIKE $${n} OR sr.location ILIKE $${n})`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function loadRequest(user, id) {
  const { rows } = await query(`${SELECT} WHERE sr.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new ApiError(404, 'Request not found');
  const allowed =
    user.role === 'admin' ||
    (user.role === 'requester' && r.requester_id === user.id) ||
    (user.role === 'officer' && r.officer_id === user.id);
  if (!allowed) throw new ApiError(403, 'You do not have access to this request');
  return r;
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

// ---- List (search / filter / pagination) ---------------------------------
router.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const f = req.query;
    const { clause, params } = buildWhere(req.user, f);
    const total = await query(
      `SELECT COUNT(*)::int AS n FROM service_requests sr
       LEFT JOIN assignments a ON a.request_id = sr.id AND a.is_active ${clause}`,
      params
    );
    const offset = (f.page - 1) * f.limit;
    const { rows } = await query(
      `${SELECT} ${clause} ORDER BY sr.created_at DESC, sr.id DESC
       LIMIT ${f.limit} OFFSET ${offset}`,
      params
    );
    res.json({
      data: rows,
      pagination: {
        page: f.page,
        limit: f.limit,
        total: total.rows[0].n,
        pages: Math.max(1, Math.ceil(total.rows[0].n / f.limit)),
      },
    });
  })
);

// ---- CSV export (admin) ----------------------------------------------------
router.get(
  '/export/csv',
  requireRole('admin'),
  validate(listSchema.omit({ page: true, limit: true }), 'query'),
  asyncHandler(async (req, res) => {
    const { clause, params } = buildWhere(req.user, req.query);
    const { rows } = await query(`${SELECT} ${clause} ORDER BY sr.created_at DESC`, params);
    const cols = [
      'id', 'title', 'category', 'priority', 'status', 'location',
      'requester_name', 'officer_name', 'created_at', 'completed_at',
    ];
    const csv = [cols.join(',')]
      .concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')))
      .join('\n');
    await audit(req.user.id, 'REQUESTS_EXPORTED', 'request', null, `${rows.length} rows`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="service-requests.csv"');
    res.send(csv);
  })
);

// ---- Create ---------------------------------------------------------------
router.post(
  '/',
  requireRole('requester', 'admin'),
  upload.single('image'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const cat = await query('SELECT 1 FROM categories WHERE id=$1', [b.category_id]);
    if (!cat.rowCount) throw new ApiError(400, 'Selected category does not exist');

    const client = await pool.connect();
    let id;
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO service_requests (title, description, location, priority, category_id, requester_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [b.title, b.description, b.location, b.priority, b.category_id, req.user.id]
      );
      id = ins.rows[0].id;
      if (req.file) {
        await client.query(
          'INSERT INTO attachments (request_id, filename, mime_type, data) VALUES ($1,$2,$3,$4)',
          [id, req.file.originalname.slice(0, 255), req.file.mimetype, req.file.buffer]
        );
      }
      await client.query(
        `INSERT INTO status_logs (request_id, old_status, new_status, note, changed_by)
         VALUES ($1,NULL,'pending','Request submitted',$2)`,
        [id, req.user.id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await audit(req.user.id, 'REQUEST_CREATED', 'request', id, b.title);
    await notifyAdmins(id, `New ${b.priority} priority request: ${b.title}`);
    res.status(201).json(await loadRequest(req.user, id));
  })
);

// ---- Read one (with timeline) -------------------------------------------
router.get(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const r = await loadRequest(req.user, Number(req.params.id));
    const logs = await query(
      `SELECT l.id, l.old_status, l.new_status, l.note, l.created_at, u.name AS changed_by
       FROM status_logs l JOIN users u ON u.id = l.changed_by
       WHERE l.request_id = $1 ORDER BY l.created_at ASC, l.id ASC`,
      [r.id]
    );
    res.json({ ...r, timeline: logs.rows });
  })
);

router.get(
  '/:id(\\d+)/attachment',
  asyncHandler(async (req, res) => {
    const r = await loadRequest(req.user, Number(req.params.id));
    const { rows } = await query(
      'SELECT mime_type, filename, data FROM attachments WHERE request_id=$1 ORDER BY id LIMIT 1',
      [r.id]
    );
    if (!rows[0]) throw new ApiError(404, 'No attachment for this request');
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(rows[0].filename)}"`);
    res.send(rows[0].data);
  })
);

// ---- Update (owner while pending, or admin) ------------------------------
router.put(
  '/:id(\\d+)',
  requireRole('requester', 'admin'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const r = await loadRequest(req.user, Number(req.params.id));
    if (req.user.role === 'requester' && r.status !== 'pending') {
      throw new ApiError(409, 'Only pending requests can be edited');
    }
    const b = { ...r, ...req.body };
    await query(
      `UPDATE service_requests SET title=$1, description=$2, location=$3, priority=$4,
              category_id=$5, updated_at=NOW() WHERE id=$6`,
      [b.title, b.description, b.location, b.priority, b.category_id, r.id]
    );
    await audit(req.user.id, 'REQUEST_UPDATED', 'request', r.id, b.title);
    res.json(await loadRequest(req.user, r.id));
  })
);

// ---- Delete (owner while pending, or admin) -------------------------------
router.delete(
  '/:id(\\d+)',
  requireRole('requester', 'admin'),
  asyncHandler(async (req, res) => {
    const r = await loadRequest(req.user, Number(req.params.id));
    if (req.user.role === 'requester' && r.status !== 'pending') {
      throw new ApiError(409, 'Only pending requests can be deleted');
    }
    await query('DELETE FROM service_requests WHERE id=$1', [r.id]);
    await audit(req.user.id, 'REQUEST_DELETED', 'request', r.id, r.title);
    res.status(204).end();
  })
);

// ---- Assign to officer (admin) ---------------------------------------------
router.post(
  '/:id(\\d+)/assign',
  requireRole('admin'),
  validate(assignSchema),
  asyncHandler(async (req, res) => {
    const r = await loadRequest(req.user, Number(req.params.id));
    if (['completed', 'cancelled'].includes(r.status)) {
      throw new ApiError(409, `Cannot assign a ${r.status} request`);
    }
    const off = await query(
      `SELECT u.id, u.name FROM users u JOIN roles ro ON ro.id=u.role_id
       WHERE u.id=$1 AND ro.name='officer' AND u.is_active`,
      [req.body.officer_id]
    );
    if (!off.rows[0]) throw new ApiError(400, 'Selected user is not an active maintenance officer');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE assignments SET is_active=FALSE WHERE request_id=$1 AND is_active', [r.id]);
      await client.query(
        'INSERT INTO assignments (request_id, officer_id, assigned_by) VALUES ($1,$2,$3)',
        [r.id, off.rows[0].id, req.user.id]
      );
      const newStatus = r.status === 'pending' ? 'assigned' : r.status;
      await client.query('UPDATE service_requests SET status=$1, updated_at=NOW() WHERE id=$2', [newStatus, r.id]);
      await client.query(
        `INSERT INTO status_logs (request_id, old_status, new_status, note, changed_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.id, r.status, newStatus, `Assigned to ${off.rows[0].name}`, req.user.id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await audit(req.user.id, 'REQUEST_ASSIGNED', 'request', r.id, `to officer ${off.rows[0].id}`);
    await notify(off.rows[0].id, r.id, `You have been assigned: ${r.title}`);
    await notify(r.requester_id, r.id, `Your request "${r.title}" was assigned to ${off.rows[0].name}`);
    res.json(await loadRequest(req.user, r.id));
  })
);

// ---- Status update (officer on own jobs, admin, requester cancel) ----------
const OFFICER_FLOW = { assigned: ['in_progress'], in_progress: ['completed'] };

router.patch(
  '/:id(\\d+)/status',
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const r = await loadRequest(req.user, Number(req.params.id));
    const { status, note } = req.body;
    if (status === r.status) throw new ApiError(409, `Request is already ${status}`);

    if (req.user.role === 'officer') {
      if (!(OFFICER_FLOW[r.status] || []).includes(status)) {
        throw new ApiError(409, `Officers cannot move a request from ${r.status} to ${status}`);
      }
    } else if (req.user.role === 'requester') {
      if (status !== 'cancelled' || r.status !== 'pending') {
        throw new ApiError(403, 'You can only cancel your own pending requests');
      }
    } else if (status === 'assigned') {
      throw new ApiError(400, 'Use the assign endpoint to assign a request');
    }

    await query(
      `UPDATE service_requests SET status=$1::varchar, updated_at=NOW(),
              completed_at = CASE WHEN $1::varchar = 'completed' THEN NOW() ELSE NULL END WHERE id=$2`,
      [status, r.id]
    );
    await query(
      `INSERT INTO status_logs (request_id, old_status, new_status, note, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [r.id, r.status, status, note || null, req.user.id]
    );
    await audit(req.user.id, 'STATUS_CHANGED', 'request', r.id, `${r.status} -> ${status}`);
    const label = status.replace('_', ' ');
    if (req.user.id !== r.requester_id) {
      await notify(r.requester_id, r.id, `Your request "${r.title}" is now ${label}`);
    }
    if (req.user.role === 'officer') {
      await notifyAdmins(r.id, `${req.user.name} marked "${r.title}" as ${label}`);
    }
    res.json(await loadRequest(req.user, r.id));
  })
);

module.exports = router;
