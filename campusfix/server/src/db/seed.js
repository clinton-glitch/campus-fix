const bcrypt = require('bcryptjs');
const { pool, query, migrate } = require('./pool');

async function upsertUser(name, email, password, role) {
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (name, email, password_hash, role_id)
     VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name=$4))
     ON CONFLICT (email) DO NOTHING`,
    [name, email, hash, role]
  );
}

(async () => {
  await migrate();
  await upsertUser('System Admin', 'admin@campusfix.test', 'Admin@123', 'admin');
  await upsertUser('Musa Officer', 'officer@campusfix.test', 'Officer@123', 'officer');
  await upsertUser('Ada Officer', 'officer2@campusfix.test', 'Officer@123', 'officer');
  await upsertUser('Student Demo', 'student@campusfix.test', 'Student@123', 'requester');
  console.log('Seed complete. Demo logins:');
  console.log('  admin@campusfix.test    / Admin@123');
  console.log('  officer@campusfix.test  / Officer@123');
  console.log('  student@campusfix.test  / Student@123');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
