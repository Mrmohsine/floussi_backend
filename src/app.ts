import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import categoryRoutes from './modules/categories/categories.routes';
import budgetRoutes from './modules/budgets/budgets.routes';
import incomeRoutes from './modules/incomes/incomes.routes';
import expenseRoutes from './modules/expenses/expenses.routes';
import savingsRoutes from './modules/savings/savings.routes';
import debtRoutes from './modules/debts/debts.routes';
import recurringRoutes from './modules/recurring/recurring.routes';
import insightsRoutes from './modules/insights/insights.routes';
import chatRoutes from './modules/chat/chat.routes';
import billingRoutes from './modules/billing/billing.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import plaidRoutes from './modules/plaid/plaid.routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { rateLimit } from './middleware/rateLimit';
import { env } from './config/env';

const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', 1);

const allowedOrigins = env.CORS_ORIGINS
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      cb(null, true);
      return;
    }
    cb(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '1mb' }));
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/', (_req, res) => res.json({ ok: true, service: 'paycheck-api' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/api/auth/login', rateLimit({
  keyPrefix: 'auth-login',
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Too many login attempts. Try again soon.',
}));
app.use('/api/auth/register', rateLimit({
  keyPrefix: 'auth-register',
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts. Try again later.',
}));
app.use('/api/chat', rateLimit({
  keyPrefix: 'chat',
  windowMs: 60 * 1000,
  max: 12,
  message: 'Too many AI requests. Try again in a minute.',
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/incomes', incomeRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/recurring-bills', recurringRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/plaid', plaidRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
module.exports = app;
