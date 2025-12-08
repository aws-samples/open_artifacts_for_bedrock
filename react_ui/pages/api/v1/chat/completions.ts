import { NextApiRequest, NextApiResponse } from 'next';
import { proxyPostRequest } from '../../../../lib/api-utils';

// Configure API route to handle large request bodies for image content
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return proxyPostRequest(req, res, '/v1/chat/completions');
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
