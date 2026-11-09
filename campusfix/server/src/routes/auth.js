const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../db/pool');
const { ApiError, asyncHandler, validate } = require('../utils');
const { authenticate, signToken } = require('../middleware/auth');
const { audit } = require('../services');

const router = express.Router();

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  password: passwordRule,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
});

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Public registration always creates a "requester" (student/staff). Officers and
// admins are created by an administrator only.
router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password } = req.body;
    const exists = await query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (exists.rowCount) throw new ApiError(409, 'An account with this email already exists');
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (name, email, phone, password_hash, role_id)
       VALUES ($1,$2,$3,$4,(SELECT id FROM roles WHERE name='requester'))
       RETURNING id, name, email`,
      [name, email, phone || null, hash]
    );
    const user = { ...rows[0], role: 'requester' };
    await audit(user.id, 'USER_REGISTERED', 'user', user.id, email);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email=$1`,
      [email]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new ApiError(401, 'Invalid email or password');
    if (!user.is_active) throw new ApiError(403, 'This account has been disabled');
    await audit(user.id, 'USER_LOGIN', 'user', user.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
