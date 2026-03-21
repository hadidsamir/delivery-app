export default function Logo({ size = 'md' }) {
  const sizes = {
    sm: { outer: 'w-8 h-8', text: 'text-sm', sub: 'text-[9px]' },
    md: { outer: 'w-10 h-10', text: 'text-base', sub: 'text-[10px]' },
    lg: { outer: 'w-16 h-16', text: 'text-2xl', sub: 'text-xs' },
  }
  const s = sizes[size]

  return (
    <div className="flex items-center gap-3">
      {/* Ícono cuadrado negro */}
      <div className={`${s.outer} bg-black dark:bg-white rounded-xl flex flex-col items-center justify-center shrink-0`}>
        <span className={`${s.text} font-black text-white dark:text-black leading-none tracking-tighter`}>10</span>
        <span className={`${s.sub} font-bold text-orange-400 dark:text-orange-500 leading-none tracking-widest uppercase`}>.12</span>
      </div>
      {/* Texto */}
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-black text-gray-900 dark:text-white tracking-tight">1012</span>
        <span className="text-xs font-semibold text-orange-500 tracking-[0.2em] uppercase">Delivery</span>
      </div>
    </div>
  )
}
