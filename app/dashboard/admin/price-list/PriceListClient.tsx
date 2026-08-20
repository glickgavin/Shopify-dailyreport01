'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type MarketKey = 'US' | 'CA' | 'EU' | 'UK';

interface Variant {
  id: string;
  title: string;
  prices: Record<MarketKey, number | null>;
}
interface Discount {
  key: string;
  name: string;
  kind: 'code' | 'automatic';
  active: boolean;
  percentage: number | null; // 0–1, full precision
  minQuantity: number | null;
}
interface PriceListData {
  product: { id: string; title: string; variants: Variant[] };
  discounts: Discount[];
  fetchedAt: string;
}
interface ProductOption { id: string; title: string }

const MARKETS: { key: MarketKey; label: string; symbol: string }[] = [
  { key: 'US', label: 'USA',    symbol: '$'  },
  { key: 'CA', label: 'Canada', symbol: 'C$' },
  { key: 'EU', label: 'EU',     symbol: '€'  },
  { key: 'UK', label: 'UK',     symbol: '£'  },
];

const fmt = (symbol: string, amount: number | null) =>
  amount === null ? '—' : `${symbol}${amount.toFixed(2)}`;

// 0.15 → "15%", 0.125 → "12.5%"
const pctLabel = (p: number | null) =>
  p === null ? '?' : `${parseFloat((p * 100).toFixed(2))}%`;

const numericId = (gid: string) => gid.split('/').pop() ?? gid;

const cellStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};
const headStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  fontWeight: 600,
  background: '#f9fafb',
  borderBottom: '2px solid #d1d5db',
};
const labelCell: React.CSSProperties = { ...cellStyle, textAlign: 'left', fontWeight: 500 };
const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  minWidth: 480,
  fontSize: 14,
  background: '#fff',
  border: '1px solid #e5e7eb',
};
const h2Style: React.CSSProperties = { fontSize: 18, fontWeight: 700, margin: '32px 0 12px' };

function InactiveRow({ name, extraCols }: { name: string; extraCols: number }) {
  return (
    <tr style={{ color: '#9ca3af', background: '#f9fafb' }}>
      <td style={{ ...labelCell, fontWeight: 400 }}>{name}</td>
      <td style={{ ...cellStyle, textAlign: 'left', fontStyle: 'italic' }} colSpan={extraCols}>
        not active
      </td>
    </tr>
  );
}

export default function PriceListClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productParam = searchParams.get('product') ?? '';

  const [data, setData] = useState<PriceListData | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = productParam ? `?product=${encodeURIComponent(productParam)}` : '';
      const res = await fetch(`/api/price-list${q}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [productParam]);

  useEffect(() => { load(); }, [load]);

  // Product picker options load once; failure just leaves the dropdown empty.
  useEffect(() => {
    fetch('/api/price-list?list=true', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setProducts(j.products ?? []))
      .catch(() => {});
  }, []);

  const selectProduct = (gid: string) => {
    router.replace(`/dashboard/admin/price-list?product=${numericId(gid)}`);
  };

  const [idInput, setIdInput] = useState('');
  const submitId = (e: React.FormEvent) => {
    e.preventDefault();
    const id = numericId(idInput.trim());
    if (id) selectProduct(id);
  };

  if (loading && !data) {
    return <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>Loading live prices from Shopify…</div>;
  }
  if (error && !data) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#dc2626' }}>Failed to load: {error}</p>
        <button onClick={load} style={{ marginTop: 8, padding: '6px 14px', cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const { product, discounts, fetchedAt } = data;

  // Sort by discount depth ascending; unknown-percentage (inactive) rows last.
  const sortedDiscounts = [...discounts].sort((a, b) => {
    if (a.percentage === null && b.percentage === null) return 0;
    if (a.percentage === null) return 1;
    if (b.percentage === null) return -1;
    return a.percentage - b.percentage;
  });

  const bundles = discounts.filter(d => d.key.startsWith('bundle'));
  // Bundle baskets are priced on the smallest (first) variant.
  const bundleVariant = product.variants[0] ?? null;

  return (
    <div style={{ padding: '24px 32px 64px', fontFamily: 'system-ui, sans-serif', color: '#111827', maxWidth: 1520 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Price List — {product.title}</h1>
        {products.length > 0 && (
          <select
            value={product.id}
            onChange={e => selectProduct(e.target.value)}
            disabled={loading}
            style={{ padding: '5px 8px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, maxWidth: 360 }}
          >
            {!products.some(p => p.id === product.id) && (
              <option value={product.id}>{product.title} — {numericId(product.id)}</option>
            )}
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.title} — {numericId(p.id)}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Last refreshed: {new Date(fetchedAt).toLocaleString()}
        </span>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '6px 14px', fontSize: 13, cursor: loading ? 'wait' : 'pointer',
            border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        {error && <span style={{ color: '#dc2626', fontSize: 13 }}>refresh failed: {error}</span>}
      </div>

      <form onSubmit={submitId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <label htmlFor="product-id-input" style={{ fontSize: 13, color: '#6b7280' }}>
          Product ID:
        </label>
        <input
          id="product-id-input"
          value={idInput}
          onChange={e => setIdInput(e.target.value)}
          placeholder={numericId(product.id)}
          inputMode="numeric"
          style={{
            padding: '5px 8px', fontSize: 13, border: '1px solid #d1d5db',
            borderRadius: 6, width: 160, fontVariantNumeric: 'tabular-nums',
          }}
        />
        <button
          type="submit"
          disabled={loading || !idInput.trim()}
          style={{
            padding: '5px 14px', fontSize: 13, border: '1px solid #d1d5db',
            borderRadius: 6, background: '#fff',
            cursor: loading || !idInput.trim() ? 'default' : 'pointer',
          }}
        >
          View prices
        </button>
      </form>

      {/* SECTION 1 — Base Prices */}
      <h2 style={h2Style}>Base Prices</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...headStyle, textAlign: 'left' }}>Variant</th>
            {MARKETS.map(m => <th key={m.key} style={headStyle}>{m.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {product.variants.map(v => (
            <tr key={v.id}>
              <td style={labelCell}>{v.title}</td>
              {MARKETS.map(m => (
                <td key={m.key} style={cellStyle}>{fmt(m.symbol, v.prices[m.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* SECTION 2 — Discounted Unit Prices */}
      <h2 style={h2Style}>Discounted Unit Prices</h2>
      {product.variants.map(v => (
        <div key={v.id} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>{v.title}</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: 'left' }}>Discount</th>
                {MARKETS.map(m => <th key={m.key} style={headStyle}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sortedDiscounts.map(d => (
                !d.active || d.percentage === null ? (
                  <InactiveRow key={d.key} name={d.name} extraCols={MARKETS.length} />
                ) : (
                  <tr key={d.key}>
                    <td style={labelCell}>{d.name} ({pctLabel(d.percentage)})</td>
                    {MARKETS.map(m => {
                      const base = v.prices[m.key];
                      return (
                        <td key={m.key} style={cellStyle}>
                          {fmt(m.symbol, base === null ? null : base * (1 - d.percentage!))}
                        </td>
                      );
                    })}
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* SECTION 3 — Bundle Basket Totals (smallest variant) */}
      <h2 style={h2Style}>Bundle Basket Totals{bundleVariant ? ` (${bundleVariant.title})` : ''}</h2>
      {!bundleVariant ? (
        <p style={{ color: '#dc2626' }}>Product has no variants.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...headStyle, textAlign: 'left' }}>Bundle</th>
              {MARKETS.map(m => <th key={m.key} style={headStyle}>{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {bundles.map(d => {
              if (!d.active || d.percentage === null || d.minQuantity === null) {
                return <InactiveRow key={d.key} name={d.name} extraCols={MARKETS.length} />;
              }
              return (
                <React.Fragment key={d.key}>
                  <tr>
                    <td style={labelCell}>
                      {d.name} ({pctLabel(d.percentage)}) — min {d.minQuantity} tiles
                    </td>
                    {MARKETS.map(m => {
                      const base = bundleVariant.prices[m.key];
                      return (
                        <td key={m.key} style={cellStyle}>
                          {fmt(m.symbol, base === null ? null : base * d.minQuantity! * (1 - d.percentage!))}
                        </td>
                      );
                    })}
                  </tr>
                  <tr style={{ color: '#6b7280', fontSize: 12.5 }}>
                    <td style={{ ...cellStyle, textAlign: 'left', fontStyle: 'italic', borderBottom: '1px solid #e5e7eb' }}>
                      marginal cost per extra tile
                    </td>
                    {MARKETS.map(m => {
                      const base = bundleVariant.prices[m.key];
                      return (
                        <td key={m.key} style={{ ...cellStyle, fontStyle: 'italic' }}>
                          {fmt(m.symbol, base === null ? null : base * (1 - d.percentage!))}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 24, fontSize: 12.5, color: '#6b7280' }}>
        All figures are computed live from Shopify contextual pricing and current discount
        percentages on each load. Display values are rounded to 2 decimals; computations use
        full precision.
      </p>
    </div>
  );
}
