import { NextApiRequest, NextApiResponse } from 'next';
import { proxyGetRequest } from '../../../../lib/api/utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return proxyGetRequest(req, res, '/v1/list/mcp_server');
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
