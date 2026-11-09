const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
});

const query = (text, params) => pool.query(text, params);

/** Creates tables (idempotent) and seeds roles + default categories. */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(
    `INSERT INTO roles (name, description) VALUES
      ('requester','Student or staff member who submits service requests'),
      ('officer','Maintenance officer who works on assigned requests'),
      ('admin','Administrator who manages users, assignments and reports')
     ON CONFLICT (name) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO categories (name, description) VALUES
      ('Electricity','Faulty sockets, lighting, power outages'),
      ('Furniture','Damaged desks, chairs, beds, lockers'),
      ('Plumbing','Leaking pipes, blocked drains, water supply'),
      ('Internet / Network','Wi-Fi and network connectivity problems'),
      ('Classroom Equipment','Projectors, whiteboards, audio systems'),
      ('Hostel Maintenance','Hostel rooms, bathrooms and common areas')
     ON CONFLICT (name) DO NOTHING`
  );
}

module.exports = { pool, query, migrate };
