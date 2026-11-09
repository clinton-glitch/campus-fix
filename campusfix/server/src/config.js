require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  port: process.env.PORT || 4000,
  databaseUrl:
    process.env.DATABASE_URL ||
    (isTest
      ? 'postgres://fixit:fixit@localhost:5432/fixit_test'
      : 'postgres://fixit:fixit@localhost:5432/fixit'),
  dbSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  maxUploadBytes: 2 * 1024 * 1024,
  isTest,
};
