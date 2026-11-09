process.env.NODE_ENV = 'test';
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { pool, query, migrate } = require('../src/db/pool');

const tokens = {};
const ids = {};

async function mkUser(key, name, email, role) {
  const hash = await bcrypt.hash('Passw0rd!', 4);
  const { rows } = await query(
    `INSERT INTO users (name,email,password_hash,role_id)
     VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name=$4)) RETURNING id`,
    [name, email, hash, role]
  );
  ids[key] = rows[0].id;
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' });
  tokens[key] = res.body.token;
}
const auth = (k) => ({ Authorization: `Bearer ${tokens[k]}` });
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
let reqId;

beforeAll(async () => {
  await migrate();
  await query(
    'TRUNCATE audit_logs, notifications, status_logs, assignments, attachments, service_requests, users, categories RESTART IDENTITY CASCADE'
  );
  await migrate(); // re-seed default categories with predictable ids
  await mkUser('admin', 'Admin', 'admin@t.test', 'admin');
  await mkUser('officer', 'Officer', 'officer@t.test', 'officer');
  await mkUser('officer2', 'Officer Two', 'officer2@t.test', 'officer');
  await mkUser('student', 'Student', 'student@t.test', 'requester');
  await mkUser('student2', 'Student Two', 'student2@t.test', 'requester');
});
afterAll(() => pool.end());

describe('Authentication', () => {
  test('registers a new requester and returns a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New Person', email: 'new@t.test', password: 'Secret123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('requester');
  });

  test('cannot self-register as admin (role field is ignored)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sneaky', email: 'sneaky@t.test', password: 'Secret123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('requester');
  });

  test('rejects duplicate email with 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup', email: 'new@t.test', password: 'Secret123' });
    expect(res.status).toBe(409);
  });

  test('rejects weak password with field-level validation errors', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Weak', email: 'weak@t.test', password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d) => d.field === 'password')).toBe(true);
  });

  test('stores passwords hashed, never in plain text', async () => {
    const { rows } = await query("SELECT password_hash FROM users WHERE email='new@t.test'");
    expect(rows[0].password_hash).not.toBe('Secret123');
    expect(rows[0].password_hash.startsWith('$2')).toBe(true);
  });

  test('login succeeds with correct credentials and fails with wrong ones', async () => {
    const ok = await request(app).post('/api/auth/login').send({ email: 'student@t.test', password: 'Passw0rd!' });
    expect(ok.status).toBe(200);
    const bad = await request(app).post('/api/auth/login').send({ email: 'student@t.test', password: 'nope' });
    expect(bad.status).toBe(401);
  });

  test('protected route needs a valid token', async () => {
    expect((await request(app).get('/api/requests')).status).toBe(401);
    expect((await request(app).get('/api/requests').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth('student'))).body.user.email).toBe('student@t.test');
  });
});

describe('Service requests CRUD', () => {
  test('student creates a request with an image upload', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set(auth('student'))
      .field('title', 'Leaking pipe in Hostel B')
      .field('description', 'Water is leaking from the pipe under the sink')
      .field('location', 'Hostel B, Room 12')
      .field('category_id', '3')
      .field('priority', 'high')
      .attach('image', png, { filename: 'leak.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.has_attachment).toBe(true);
    reqId = res.body.id;
  });

  test('validation: rejects short title/description and bad category', async () => {
    const res = await request(app).post('/api/requests').set(auth('student')).send({ title: 'x', description: 'y', location: '', category_id: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThanOrEqual(3);
  });

  test('rejects non-image uploads', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set(auth('student'))
      .field('title', 'Broken socket here')
      .field('description', 'Socket sparks when used')
      .field('location', 'Lab 2')
      .field('category_id', '1')
      .attach('image', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  test('officers cannot submit requests (RBAC)', async () => {
    const res = await request(app).post('/api/requests').set(auth('officer')).send({
      title: 'Officer request', description: 'Should not be allowed', location: 'X1', category_id: 1,
    });
    expect(res.status).toBe(403);
  });

  test('owner can view detail with timeline and attachment; others cannot', async () => {
    const ok = await request(app).get(`/api/requests/${reqId}`).set(auth('student'));
    expect(ok.status).toBe(200);
    expect(ok.body.timeline[0].new_status).toBe('pending');
    const img = await request(app).get(`/api/requests/${reqId}/attachment`).set(auth('student'));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect((await request(app).get(`/api/requests/${reqId}`).set(auth('student2'))).status).toBe(403);
    expect((await request(app).get('/api/requests/9999').set(auth('admin'))).status).toBe(404);
  });

  test('owner can edit while pending', async () => {
    const res = await request(app).put(`/api/requests/${reqId}`).set(auth('student')).send({ priority: 'urgent' });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('urgent');
  });

  test('admin was notified of the new request', async () => {
    const res = await request(app).get('/api/notifications').set(auth('admin'));
    expect(res.body.unread).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].message).toContain('Leaking pipe');
  });
});

describe('List, search, filter and pagination', () => {
  beforeAll(async () => {
    for (let i = 1; i <= 12; i++) {
      await request(app).post('/api/requests').set(auth('student')).send({
        title: `Projector fault ${i}`, description: 'Projector does not turn on in the room',
        location: `Block A Room ${i}`, category_id: 5, priority: 'low',
      });
    }
    await request(app).post('/api/requests').set(auth('student2')).send({
      title: 'Wi-Fi down on 2nd floor', description: 'No internet connection at all', location: 'Library', category_id: 4,
    });
  });

  test('paginates results', async () => {
    const p1 = await request(app).get('/api/requests?limit=5&page=1').set(auth('admin'));
    expect(p1.body.data).toHaveLength(5);
    expect(p1.body.pagination.total).toBe(14);
    expect(p1.body.pagination.pages).toBe(3);
    const p3 = await request(app).get('/api/requests?limit=5&page=3').set(auth('admin'));
    expect(p3.body.data).toHaveLength(4);
  });

  test('searches by keyword', async () => {
    const res = await request(app).get('/api/requests?search=wi-fi').set(auth('admin'));
    expect(res.body.data).toHaveLength(1);
  });

  test('filters by category and priority', async () => {
    const res = await request(app).get('/api/requests?category_id=5&priority=low').set(auth('admin'));
    expect(res.body.pagination.total).toBe(12);
  });

  test('requesters only see their own requests', async () => {
    const res = await request(app).get('/api/requests?limit=50').set(auth('student2'));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].requester_name).toBe('Student Two');
  });

  test('invalid filter values are rejected', async () => {
    expect((await request(app).get('/api/requests?status=bogus').set(auth('admin'))).status).toBe(400);
  });
});

describe('Assignment and status workflow', () => {
  test('only admins can assign', async () => {
    const res = await request(app).post(`/api/requests/${reqId}/assign`).set(auth('student')).send({ officer_id: ids.officer });
    expect(res.status).toBe(403);
  });

  test('cannot assign to a non-officer', async () => {
    const res = await request(app).post(`/api/requests/${reqId}/assign`).set(auth('admin')).send({ officer_id: ids.student });
    expect(res.status).toBe(400);
  });

  test('admin assigns to officer: status becomes assigned and both parties are notified', async () => {
    const res = await request(app).post(`/api/requests/${reqId}/assign`).set(auth('admin')).send({ officer_id: ids.officer });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('assigned');
    expect(res.body.officer_name).toBe('Officer');
    const n = await request(app).get('/api/notifications').set(auth('officer'));
    expect(n.body.data[0].message).toContain('assigned');
    const sn = await request(app).get('/api/notifications').set(auth('student'));
    expect(sn.body.unread).toBeGreaterThanOrEqual(1);
  });

  test('assigned request is visible to the officer; other officers cannot see it', async () => {
    const mine = await request(app).get('/api/requests').set(auth('officer'));
    expect(mine.body.data.map((r) => r.id)).toEqual([reqId]);
    expect((await request(app).get(`/api/requests/${reqId}`).set(auth('officer2'))).status).toBe(403);
  });

  test('owner can no longer edit once assigned', async () => {
    const res = await request(app).put(`/api/requests/${reqId}`).set(auth('student')).send({ title: 'Changed title' });
    expect(res.status).toBe(409);
  });

  test('officer cannot skip straight to completed', async () => {
    const res = await request(app).patch(`/api/requests/${reqId}/status`).set(auth('officer')).send({ status: 'completed' });
    expect(res.status).toBe(409);
  });

  test('officer moves job in_progress then completed with notes', async () => {
    const a = await request(app).patch(`/api/requests/${reqId}/status`).set(auth('officer')).send({ status: 'in_progress', note: 'On site' });
    expect(a.body.status).toBe('in_progress');
    const b = await request(app).patch(`/api/requests/${reqId}/status`).set(auth('officer')).send({ status: 'completed', note: 'Pipe replaced' });
    expect(b.body.status).toBe('completed');
    expect(b.body.completed_at).not.toBeNull();
    const detail = await request(app).get(`/api/requests/${reqId}`).set(auth('student'));
    expect(detail.body.timeline.map((t) => t.new_status)).toEqual(['pending', 'assigned', 'in_progress', 'completed']);
  });

  test('closed requests cannot be re-assigned', async () => {
    const res = await request(app).post(`/api/requests/${reqId}/assign`).set(auth('admin')).send({ officer_id: ids.officer2 });
    expect(res.status).toBe(409);
  });

  test('requester can cancel own pending request but not others', async () => {
    const created = await request(app).post('/api/requests').set(auth('student2')).send({
      title: 'Broken chair in class', description: 'Chair leg is broken completely', location: 'LT1', category_id: 2,
    });
    const id = created.body.id;
    expect((await request(app).patch(`/api/requests/${id}/status`).set(auth('student')).send({ status: 'cancelled' })).status).toBe(403);
    const ok = await request(app).patch(`/api/requests/${id}/status`).set(auth('student2')).send({ status: 'cancelled' });
    expect(ok.body.status).toBe('cancelled');
  });

  test('reassignment keeps exactly one active assignment', async () => {
    const created = await request(app).post('/api/requests').set(auth('student')).send({
      title: 'Socket not working', description: 'No power at the socket near window', location: 'Lab 1', category_id: 1,
    });
    const id = created.body.id;
    await request(app).post(`/api/requests/${id}/assign`).set(auth('admin')).send({ officer_id: ids.officer });
    await request(app).post(`/api/requests/${id}/assign`).set(auth('admin')).send({ officer_id: ids.officer2 });
    const { rows } = await query('SELECT officer_id, is_active FROM assignments WHERE request_id=$1 ORDER BY id', [id]);
    expect(rows).toEqual([{ officer_id: ids.officer, is_active: false }, { officer_id: ids.officer2, is_active: true }]);
  });
});

describe('Admin features', () => {
  test('stats are role scoped', async () => {
    const admin = await request(app).get('/api/stats').set(auth('admin'));
    expect(admin.body.total).toBe(16);
    expect(admin.body.byCategory.length).toBeGreaterThan(0);
    const student2 = await request(app).get('/api/stats').set(auth('student2'));
    expect(student2.body.total).toBe(2);
    expect(student2.body.byCategory).toBeUndefined();
  });

  test('CSV export works for admin only and neutralises formulas', async () => {
    await request(app).post('/api/requests').set(auth('admin')).send({
      title: '=HYPERLINK("http://x")', description: 'formula injection test', location: 'X1', category_id: 1,
    });
    const res = await request(app).get('/api/requests/export/csv').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('id,title');
    expect(res.text).toContain(`"'=HYPERLINK`);
    expect((await request(app).get('/api/requests/export/csv').set(auth('student'))).status).toBe(403);
  });

  test('user management: admin creates officer, disables account, disabled user is locked out', async () => {
    const created = await request(app).post('/api/users').set(auth('admin')).send({ name: 'New Officer', email: 'no@t.test', password: 'Officer123', role: 'officer' });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('officer');
    const login = await request(app).post('/api/auth/login').send({ email: 'no@t.test', password: 'Officer123' });
    const dis = await request(app).patch(`/api/users/${created.body.id}`).set(auth('admin')).send({ is_active: false });
    expect(dis.body.is_active).toBe(false);
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${login.body.token}` })).status).toBe(401);
    expect((await request(app).get('/api/users').set(auth('student'))).status).toBe(403);
  });

  test('admin cannot change own role', async () => {
    expect((await request(app).patch(`/api/users/${ids.admin}`).set(auth('admin')).send({ role: 'requester' })).status).toBe(400);
  });

  test('audit trail records key actions and is admin only', async () => {
    const res = await request(app).get('/api/audit?limit=100').set(auth('admin'));
    const actions = res.body.data.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['REQUEST_CREATED', 'REQUEST_ASSIGNED', 'STATUS_CHANGED', 'USER_CREATED']));
    expect((await request(app).get('/api/audit').set(auth('officer'))).status).toBe(403);
  });

  test('categories: list for all, create for admin only, duplicate rejected', async () => {
    expect((await request(app).get('/api/categories').set(auth('student'))).body.data.length).toBe(6);
    expect((await request(app).post('/api/categories').set(auth('student')).send({ name: 'Security' })).status).toBe(403);
    expect((await request(app).post('/api/categories').set(auth('admin')).send({ name: 'Security' })).status).toBe(201);
    expect((await request(app).post('/api/categories').set(auth('admin')).send({ name: 'Security' })).status).toBe(409);
  });

  test('mark notifications read', async () => {
    await request(app).post('/api/notifications/read-all').set(auth('admin'));
    expect((await request(app).get('/api/notifications').set(auth('admin'))).body.unread).toBe(0);
  });

  test('unknown endpoints return JSON 404 and Swagger spec is served', async () => {
    const nf = await request(app).get('/api/nope').set(auth('admin'));
    expect(nf.status).toBe(404);
    const spec = await request(app).get('/api/openapi.json');
    expect(spec.body.openapi).toBe('3.0.3');
  });
});
