import { checkAdminCredentials, issueAdminCookie, json, methodNotAllowed, readBody, type VercelRequest, type VercelResponse } from '../server'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const body = readBody(req)
    if (typeof body.email !== 'string' || typeof body.password !== 'string') return json(res, 400, { error: 'Email dan password wajib diisi.' })
    if (!checkAdminCredentials(body.email, body.password)) return json(res, 401, { error: 'Email atau password salah.' })
    res.setHeader('Set-Cookie', issueAdminCookie(body.email.trim().toLowerCase()))
    return json(res, 200, { authenticated: true, email: body.email.trim().toLowerCase() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login gagal.'
    return json(res, message.includes('Environment variable') ? 503 : 400, { error: message })
  }
}
