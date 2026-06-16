import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 7,
          background: '#1a2e23',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '5px 6px 4px',
          gap: 0,
        }}
      >
        {/* Bar chart */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginBottom: 3 }}>
          <div style={{ width: 5, height: 8,  background: '#fff', borderRadius: 1 }} />
          <div style={{ width: 5, height: 11, background: '#fff', borderRadius: 1 }} />
          <div style={{ width: 5, height: 15, background: '#fff', borderRadius: 1 }} />
        </div>
        {/* Green underline */}
        <div style={{ width: 20, height: 2.5, background: '#4ade80', borderRadius: 1 }} />
      </div>
    ),
    { ...size },
  );
}
