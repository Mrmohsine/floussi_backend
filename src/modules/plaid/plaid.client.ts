import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { env } from '../../config/env';
import { HttpError } from '../../utils/errors';

let _client: PlaidApi | null = null;

export function plaid(): PlaidApi {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw new HttpError(
      503,
      'Bank linking is unavailable — backend is missing PLAID_CLIENT_ID or PLAID_SECRET.',
    );
  }
  if (_client) return _client;

  const basePath = PlaidEnvironments[env.PLAID_ENV];
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
        'PLAID-SECRET': env.PLAID_SECRET,
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}
