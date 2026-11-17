export function PhotoIllustration() {
  return (
    <svg className="portrait-art" viewBox="0 0 640 470" role="img" aria-label="Ilustrasi teman berfoto bersama">
      <defs>
        <linearGradient id="portrait-bg" x1=".1" y1="0" x2=".9" y2="1">
          <stop stopColor="#ffabc9" />
          <stop offset="1" stopColor="#f86d9f" />
        </linearGradient>
        <linearGradient id="dress" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#fef9f6" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
      </defs>
      <rect width="640" height="470" rx="34" fill="url(#portrait-bg)" />
      <circle cx="515" cy="100" r="65" fill="#ffe7f0" opacity=".35" />
      <circle cx="105" cy="360" r="82" fill="#4298ed" opacity=".28" />
      <path d="M0 370c77-47 139-54 218-13 91 48 160 58 253 7 72-40 114-38 169-10v116H0z" fill="#f7bfd3" opacity=".55" />
      <path d="M149 431c5-91 30-157 82-174 36-12 73 6 88 40 21 48 22 86 25 134z" fill="#fdf7f2" />
      <path d="M355 431c1-103 24-167 78-179 50-11 85 22 95 75 7 38 6 70 6 104z" fill="#478dd7" />
      <path d="M236 241c-8-46 8-84 48-89 40-6 62 25 57 69-4 38-25 63-54 62-28-1-45-17-51-42" fill="#b87152" />
      <path d="M234 225c-15-41 2-88 42-101 41-13 75 8 78 52-15-17-37-23-58-15-19 8-35 27-62 25z" fill="#342725" />
      <path d="M420 226c-8-39 6-74 40-78 36-4 55 23 51 61-4 35-21 56-47 54-25-1-39-14-44-37" fill="#efbf94" />
      <path d="M414 209c-6-41 16-76 51-78 36-3 58 24 50 65-11-12-26-21-43-20-22 1-35 19-58 33z" fill="#3a2b29" />
      <circle cx="268" cy="235" r="4" fill="#36221f" />
      <circle cx="316" cy="233" r="4" fill="#36221f" />
      <path d="M276 258q17 14 34-1" fill="none" stroke="#9e5146" strokeWidth="4" strokeLinecap="round" />
      <circle cx="442" cy="224" r="3.5" fill="#36221f" />
      <circle cx="478" cy="222" r="3.5" fill="#36221f" />
      <path d="M446 244q13 12 26-1" fill="none" stroke="#ad6459" strokeWidth="3.5" strokeLinecap="round" />
      <path d="m199 172 6 15 16 2-13 10 4 16-13-9-14 9 5-16-12-10 16-1z" fill="#fff" opacity=".9" />
      <path d="m540 282 4 11 12 2-10 7 3 12-10-7-10 7 4-12-10-7 12-2z" fill="#fff" opacity=".8" />
      <rect x="22" y="22" width="126" height="36" rx="18" fill="#fff" opacity=".9" />
      <circle cx="42" cy="40" r="5" fill="#4298ed" />
      <text x="56" y="45" fill="#4b3540" fontSize="12" fontFamily="Arial, sans-serif" fontWeight="700" letterSpacing="1.2">MOMEN KITA</text>
    </svg>
  )
}
