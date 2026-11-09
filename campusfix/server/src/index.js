const app = require('./app');
const config = require('./config');
const { migrate } = require('./db/pool');

migrate()
  .then(() => app.listen(config.port, () => console.log(`CampusFix API listening on :${config.port}`)))
  .catch((e) => {
    console.error('Failed to start', e);
    process.exit(1);
  });
