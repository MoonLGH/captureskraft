import { ArrowLeft, ArrowRight, Mail, UserRound } from 'lucide-react'

type CustomerDetailsScreenProps = {
  name: string
  email: string
  onNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onBack: () => void
  onContinue: () => void
}

export function CustomerDetailsScreen({ name, email, onNameChange, onEmailChange, onBack, onContinue }: CustomerDetailsScreenProps) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canContinue = name.trim().length > 0 && name.trim().length <= 100 && emailValid

  return (
    <section className="flow-page customer-details-page">
      <div className="flow-heading">
        <div className="eyebrow">LANGKAH 03 · DETAIL PELANGGAN</div>
        <h2>Simpan hasil fotomu.</h2>
        <p>Masukkan nama dan email untuk dicatat bersama sesi fotomu.</p>
      </div>

      <form className="customer-details-card admin-card" onSubmit={(event) => { event.preventDefault(); if (canContinue) onContinue() }}>
        <label className="customer-field"><span><UserRound size={16} /> Nama</span><input className="admin-input" type="text" name="customer-name" value={name} onChange={(event) => onNameChange(event.target.value)} autoComplete="name" maxLength={100} placeholder="Nama kamu" required /></label>
        <label className="customer-field"><span><Mail size={16} /> Email</span><input className="admin-input" type="email" name="customer-email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" maxLength={254} placeholder="nama@email.com" required /></label>
        <small className="field-help">Nama dan email disimpan bersama file sesi di perangkat booth.</small>
        <button className="primary-cta compact customer-continue-button" type="submit" disabled={!canContinue}><span>Lanjut pilih frame</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
      </form>

      <div className="flow-actions"><button className="soft-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Kembali</button></div>
      <div className="flow-progress"><span className="active" /><span className="active" /><span className="active" /><span /><span /></div>
    </section>
  )
}
