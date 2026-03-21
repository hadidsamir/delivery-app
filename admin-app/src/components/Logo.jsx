export default function Logo({ size = 'md' }) {
  const heights = { sm: 'h-8', md: 'h-10', lg: 'h-14' }

  return (
    <img
      src="/logo.png"
      alt="1012 Delivery"
      className={`${heights[size]} w-auto object-contain`}
    />
  )
}
