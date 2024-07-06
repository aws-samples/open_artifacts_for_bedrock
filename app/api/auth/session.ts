'use server'
import { getSession } from 'next-auth/react'
export default async function handler(req, res) {
  const session = await getSession({ req })
  if (session) {
    session.user = { ...session.user, name: req.body.username }
    await req.session.save()
    res.status(200).json({ message: 'Session updated' })
  } else {
    res.status(401).json({ message: 'Unauthorized' })
  }
}