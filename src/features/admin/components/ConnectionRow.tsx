import type { LucideIcon } from 'lucide-react'

export function ConnectionRow({ icon: Icon, name, info, active }: { icon: LucideIcon; name: string; info: string; active: boolean }) {
  return <div className="connection-row"><span className="connection-mini-icon"><Icon size={16} /></span><span><b>{name}</b><small>{info}</small></span><span className={`connection-indicator ${active ? 'active' : ''}`}><i /></span></div>
}

