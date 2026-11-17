import { CheckCircle2 } from 'lucide-react'

type ToastMessageProps = {
  message: string
}

export function ToastMessage({ message }: ToastMessageProps) {
  return <div className="toast-message"><CheckCircle2 size={18} />{message}</div>
}
