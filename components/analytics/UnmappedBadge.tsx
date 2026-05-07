import Link from 'next/link';

interface Props {
  count: number;
  href?: string;
}

export default function UnmappedBadge({ count, href = '/configuration/unmapped' }: Props) {
  if (count === 0) return null;
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '0.2rem 0.55rem',
        borderRadius: 6,
        background: '#fef3c7',
        color: '#92400e',
        border: '1px solid #fcd34d',
        fontSize: '0.75rem',
        fontWeight: 600,
        textDecoration: 'none',
        lineHeight: 1,
      }}
    >
      ⚠ {count} unmapped
    </Link>
  );
}
