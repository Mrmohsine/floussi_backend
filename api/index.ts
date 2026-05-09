import type { Express, Request, Response } from 'express';

const app = require('../src/app') as Express;

export default function handler(req: Request, res: Response) {
  return app(req, res);
}
