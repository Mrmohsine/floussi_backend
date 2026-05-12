import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  type?: 'access' | 'refresh';
}

export const signToken = (payload: JwtPayload) =>
  jwt.sign({ ...payload, type: 'access' }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const signRefreshToken = (payload: JwtPayload) =>
  jwt.sign({ ...payload, type: 'refresh' }, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const verifyToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  if (payload.type === 'refresh') {
    throw new Error('Refresh token cannot be used as an access token.');
  }
  return payload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  if (payload.type !== 'refresh') {
    throw new Error('Invalid refresh token.');
  }
  return payload;
};
