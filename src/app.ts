import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import categoryRoutes from './modules/categories/categories.routes';
import budgetRoutes from './modules/budgets/budgets.routes';
import expenseRoutes from './modules/expenses/expenses.routes';
import savingsRoutes from './modules/savings/savings.routes';
import debtRoutes from './modules/debts/debts.routes';
import recurringRoutes from './modules/recurring/recurring.routes';
import insightsRoutes from './modules/insights/insights.routes';
import { errorHandler, notFoundHandler } from './middleware/error';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/recurring-bills', recurringRoutes);
app.use('/api/insights', insightsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
