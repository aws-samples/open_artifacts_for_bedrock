import { NextApiRequest, NextApiResponse } from 'next';
import { proxyDeleteRequest } from '../../../../../lib/api/utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'DELETE') {
    const { serverId } = req.query;
    
    if (!serverId || typeof serverId !== 'string') {
      return res.status(400).json({ error: 'Server ID is required' });
    }
    
    return proxyDeleteRequest(req, res, `/v1/remove/mcp_server/${serverId}`);
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
