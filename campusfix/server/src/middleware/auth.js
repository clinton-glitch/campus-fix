const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');
const { ApiError, asyncHandler } = require('../utils');

/** Verifies the Bearer JWT and loads the current user (with role name). */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.is_active, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [payload.sub]
  );
  if (!rows[0] || !rows[0].is_active) throw new ApiError(401, 'Account not found or disabled');
  req.user = rows[0];
  next();
});

/** Role-based access control guard. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  next();
};

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

module.exports = { authenticate, requireRole, signToken };
