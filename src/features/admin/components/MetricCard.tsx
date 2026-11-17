import type { LucideIcon } from 'lucide-react'

export function MetricCard({ icon: Icon, label, value, foot, tone }: { icon: LucideIcon; label: string; value: string; foot: string; tone: string }) {
  return <section className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={18} /></span><span className="metric-label">{label}</span><b className="metric-value">{value}</b><small>{foot}</small></section>
}

