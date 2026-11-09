const { query } = require('./db/pool');

async function audit(userId, action, entity, entityId, details) {
  await query(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
    [userId || null, action, entity, entityId || null, details || null]
  );
}

async function notify(userId, requestId, message) {
  if (!userId) return;
  await query('INSERT INTO notifications (user_id, request_id, message) VALUES ($1,$2,$3)', [
    userId,
    requestId || null,
    message,
  ]);
}

async function notifyAdmins(requestId, message) {
  await query(
    `INSERT INTO notifications (user_id, request_id, message)
     SELECT u.id, $1, $2 FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'admin' AND u.is_active`,
    [requestId, message]
  );
}

module.exports = { audit, notify, notifyAdmins };
