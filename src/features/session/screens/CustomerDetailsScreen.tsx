import { ArrowRight, Mail } from 'lucide-react'

type CustomerDetailsScreenProps = {
  email: string
  onEmailChange: (value: string) => void
  onContinue: () => void
}

export function CustomerDetailsScreen({ email, onEmailChange, onContinue }: CustomerDetailsScreenProps) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canContinue = emailValid

  return (
    <section className="flow-page customer-details-page">
      <div className="flow-heading">
        <div className="eyebrow">LANGKAH 03 · EMAIL HASIL FOTO</div>
        <h2>Simpan hasil fotomu.</h2>
        <p>Masukkan email untuk dicatat bersama sesi fotomu.</p>
      </div>

      <form className="customer-details-card admin-card" onSubmit={(event) => { event.preventDefault(); if (canContinue) onContinue() }}>
        <label className="customer-field"><span><Mail size={16} /> Email</span><input className="admin-input" type="email" name="customer-email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" maxLength={254} placeholder="nama@email.com" required /></label>
        <small className="field-help">Email disimpan bersama file sesi di perangkat booth.</small>
        <button className="primary-cta compact customer-continue-button" type="submit" disabled={!canContinue}><span>Lanjut pilih frame</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
      </form>

      <div className="flow-progress"><span className="active" /><span className="active" /><span className="active" /><span /><span /></div>
    </section>
  )
}
