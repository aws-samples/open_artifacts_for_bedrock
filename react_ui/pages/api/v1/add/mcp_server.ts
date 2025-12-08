import { NextApiRequest, NextApiResponse } from 'next';
import { proxyPostRequest } from '../../../../lib/api-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return proxyPostRequest(req, res, '/v1/add/mcp_server');
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
