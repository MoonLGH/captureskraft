import { clearAdminCookie, json, methodNotAllowed, type VercelRequest, type VercelResponse } from '../server'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  res.setHeader('Set-Cookie', clearAdminCookie())
  return json(res, 200, { authenticated: false })
}
