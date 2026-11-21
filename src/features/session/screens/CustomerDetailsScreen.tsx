import { ArrowLeft, ArrowRight, Mail } from 'lucide-react'

type CustomerDetailsScreenProps = {
  email: string
  onEmailChange: (value: string) => void
  continueLabel: string
  onBack: () => void
  onContinue: () => void
}

export function CustomerDetailsScreen({ email, onEmailChange, continueLabel, onBack, onContinue }: CustomerDetailsScreenProps) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canContinue = emailValid

  return (
    <section className="flow-page customer-details-page">
      <div className="flow-heading">
        <h2>Simpan hasil fotomu.</h2>
        <p>Masukkan email untuk menerima hasil foto dan informasi sesi.</p>
      </div>

      <form className="customer-details-card admin-card" onSubmit={(event) => { event.preventDefault(); if (canContinue) onContinue() }}>
        <label className="customer-field"><span><Mail size={16} /> Email</span><input className="admin-input" type="email" name="customer-email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" maxLength={254} placeholder="nama@email.com" required /></label>
        <div className="customer-details-actions">
          <button className="soft-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Kembali</button>
          <button className="primary-cta compact customer-continue-button" type="submit" disabled={!canContinue}><span>{continueLabel}</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
        </div>
      </form>

      <div className="flow-progress"><span className="active" /><span className="active" /><span className="active" /><span /><span /><span /></div>
    </section>
  )
}
