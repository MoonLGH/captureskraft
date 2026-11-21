import { adminIdentity, json, methodNotAllowed, type VercelRequest, type VercelResponse } from '../server'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const identity = adminIdentity(req)
  return json(res, 200, { authenticated: Boolean(identity), email: identity?.email ?? '' })
}
