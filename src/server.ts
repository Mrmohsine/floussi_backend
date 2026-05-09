import type { Express } from 'express';
import { env } from './config/env';

const app = require('./app') as Express;

app.listen(env.PORT, () => {
  console.log(`[paycheck] api ready on http://localhost:${env.PORT}`);
});
