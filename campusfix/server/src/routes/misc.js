const express = require('express');
const { z } = require('zod');
const { query } = require('../db/pool');
const { ApiError, asyncHandler, validate } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services');

const router = express.Router();
router.use(authenticate);

// ---- Categories -----------------------------------------------------------
const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
});

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT id, name, description FROM categories ORDER BY name');
    res.json({ data: rows });
  })
);

router.post(
  '/categories',
  requireRole('admin'),
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    try {
      const { rows } = await query(
        'INSERT INTO categories (name, description) VALUES ($1,$2) RETURNING id, name, description',
        [req.body.name, req.body.description || null]
      );
      await audit(req.user.id, 'CATEGORY_CREATED', 'category', rows[0].id, rows[0].name);
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') throw new ApiError(409, 'Category already exists');
      throw e;
    }
  })
);

// ---- Notifications --------------------------------------------------------
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, request_id, message, is_read, created_at FROM notifications
       WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 30`,
      [req.user.id]
    );
    const unread = rows.filter((n) => !n.is_read).length;
    const total = await query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT is_read',
      [req.user.id]
    );
    res.json({ data: rows, unread: total.rows[0].n || unread });
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.user.id]);
    res.json({ ok: true });
  })
);

router.patch(
  '/notifications/:id(\\d+)/read',
  asyncHandler(async (req, res) => {
    const r = await query(
      'UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!r.rowCount) throw new ApiError(404, 'Notification not found');
    res.json({ ok: true });
  })
);

// ---- Dashboard statistics (role scoped) ------------------------------------
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    let scope = '';
    const params = [];
    if (req.user.role === 'requester') {
      scope = 'WHERE sr.requester_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'officer') {
      scope = 'WHERE a.officer_id = $1';
      params.push(req.user.id);
    }
    const from = `FROM service_requests sr
                  LEFT JOIN assignments a ON a.request_id = sr.id AND a.is_active`;
    const byStatus = await query(
      `SELECT sr.status, COUNT(*)::int AS count ${from} ${scope} GROUP BY sr.status`,
      params
    );
    const counts = { pending: 0, assigned: 0, in_progress: 0, completed: 0, cancelled: 0 };
    byStatus.rows.forEach((r) => (counts[r.status] = r.count));
    const out = { total: Object.values(counts).reduce((a, b) => a + b, 0), byStatus: counts };

    if (req.user.role === 'admin') {
      const cat = await query(
        `SELECT c.name, COUNT(sr.id)::int AS count FROM categories c
         LEFT JOIN service_requests sr ON sr.category_id = c.id GROUP BY c.name ORDER BY count DESC`
      );
      const avg = await query(
        `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)::numeric, 1) AS hours
         FROM service_requests WHERE status='completed'`
      );
      const users = await query(
        `SELECT r.name AS role, COUNT(*)::int AS count FROM users u
         JOIN roles r ON r.id=u.role_id GROUP BY r.name`
      );
      out.byCategory = cat.rows;
      out.avgResolutionHours = avg.rows[0].hours === null ? null : Number(avg.rows[0].hours);
      out.usersByRole = users.rows;
    }
    res.json(out);
  })
);

// ---- Audit trail (admin) -----------------------------------------------------
const auditSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
router.get(
  '/audit',
  requireRole('admin'),
  validate(auditSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const total = await query('SELECT COUNT(*)::int AS n FROM audit_logs');
    const { rows } = await query(
      `SELECT l.id, l.action, l.entity, l.entity_id, l.details, l.created_at,
              u.name AS user_name
       FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC, l.id DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    );
    res.json({
      data: rows,
      pagination: { page, limit, total: total.rows[0].n, pages: Math.max(1, Math.ceil(total.rows[0].n / limit)) },
    });
  })
);

module.exports = router;
