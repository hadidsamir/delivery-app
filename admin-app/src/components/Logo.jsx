export default function Logo({ size = 'md' }) {
  const heights = { sm: 'h-12', md: 'h-16', lg: 'h-24' }

  return (
    <img
      src="/logo.png"
      alt="1012 Delivery"
      className={`${heights[size]} w-auto object-contain`}
    />
  )
}
