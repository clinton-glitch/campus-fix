const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../db/pool');
const { ApiError, asyncHandler, validate } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['requester', 'officer', 'admin']),
});
const patchSchema = z.object({
  role: z.enum(['requester', 'officer', 'admin']).optional(),
  is_active: z.boolean().optional(),
});

const SELECT = `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.created_at, r.name AS role
                FROM users u JOIN roles r ON r.id = u.role_id`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const role = req.query.role;
    const { rows } = role
      ? await query(`${SELECT} WHERE r.name=$1 ORDER BY u.name`, [role])
      : await query(`${SELECT} ORDER BY u.created_at DESC`);
    res.json({ data: rows });
  })
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    if ((await query('SELECT 1 FROM users WHERE email=$1', [email])).rowCount) {
      throw new ApiError(409, 'An account with this email already exists');
    }
    const hash = await bcrypt.hash(password, 10);
    const ins = await query(
      `INSERT INTO users (name,email,password_hash,role_id)
       VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name=$4)) RETURNING id`,
      [name, email, hash, role]
    );
    await audit(req.user.id, 'USER_CREATED', 'user', ins.rows[0].id, `${email} (${role})`);
    const { rows } = await query(`${SELECT} WHERE u.id=$1`, [ins.rows[0].id]);
    res.status(201).json(rows[0]);
  })
);

router.patch(
  '/:id(\\d+)',
  validate(patchSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new ApiError(400, 'You cannot change your own role or status');
    const cur = await query(`${SELECT} WHERE u.id=$1`, [id]);
    if (!cur.rows[0]) throw new ApiError(404, 'User not found');
    const role = req.body.role ?? cur.rows[0].role;
    const active = req.body.is_active ?? cur.rows[0].is_active;
    await query(
      `UPDATE users SET role_id=(SELECT id FROM roles WHERE name=$1), is_active=$2 WHERE id=$3`,
      [role, active, id]
    );
    await audit(req.user.id, 'USER_UPDATED', 'user', id, `role=${role}, active=${active}`);
    const { rows } = await query(`${SELECT} WHERE u.id=$1`, [id]);
    res.json(rows[0]);
  })
);

module.exports = router;
