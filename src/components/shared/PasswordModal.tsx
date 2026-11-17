import { ArrowRight, LockKeyhole, ShieldCheck, X } from 'lucide-react'

type PasswordModalProps = {
  password: string
  error: string
  onPasswordChange: (password: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function PasswordModal({ password, error, onPasswordChange, onClose, onSubmit }: PasswordModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="password-modal">
        <button className="modal-close" onClick={onClose} aria-label="Tutup"><X size={19} /></button>
        <div className="lock-icon"><LockKeyhole size={23} /></div>
        <div className="eyebrow">AREA KHUSUS PETUGAS</div>
        <h3>Masuk ke admin</h3>
        <p>Masukkan password untuk mengatur booth ini.</p>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
          <label htmlFor="admin-password">PASSWORD</label>
          <input id="admin-password" type="password" autoFocus value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Masukkan password" />
          {error && <div className="form-error">{error}</div>}
          <button className="primary-cta compact modal-submit" type="submit"><span>Buka menu admin</span><span className="cta-icon"><ArrowRight size={19} /></span></button>
        </form>
        <span className="admin-hint"><ShieldCheck size={14} /> Menu ini hanya untuk petugas Capturs</span>
      </section>
    </div>
  )
}
