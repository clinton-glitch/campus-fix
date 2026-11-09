# CampusFix - University Maintenance & Service Request Platform

Full-stack app (React + Node/Express + PostgreSQL) for MIT 8333 Virtual Lab.

## Run locally
```bash
# 1. PostgreSQL: create a database and user (or set DATABASE_URL)
createdb fixit
# 2. Install, seed and start
npm run install:all
cp server/.env.example server/.env
npm --prefix server run seed        # creates tables, roles, categories, demo users
npm --prefix server run dev         # API on :4000  (Swagger: /api/docs)
npm --prefix client run dev         # UI on :5173
```
Demo logins: admin@campusfix.test / Admin@123, officer@campusfix.test / Officer@123, student@campusfix.test / Student@123

## Tests
`npm test` (37 API tests against a `fixit_test` database, 19 frontend tests).

## Deploy (Render)
1. Push to GitHub. 2. Render > New > Blueprint > select repo (uses `render.yaml`).
3. After first deploy, open the service Shell and run `npm --prefix server run seed` to create the demo accounts
   (or sign up and promote the first admin with SQL). The API creates tables automatically on start.
