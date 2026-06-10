import { C } from '../theme/tokens';

export interface SlideSketch {
  t: 'title' | 'bullets' | 'chart' | 'two';
  h: string;
}

/* Static slide sketch — Stage 3 replaces these with real thumbnails (soffice) or
   extraction-based previews. */
export function MiniSlide({ s, active }: { s: SlideSketch; active: boolean }) {
  return (
    <div
      className="rounded-md p-2 flex flex-col gap-1"
      style={{
        aspectRatio: '16/9',
        background: '#f5f2ea',
        border: active ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          height: 5,
          width: s.t === 'title' ? '70%' : '50%',
          background: '#c96a47',
          borderRadius: 2,
          marginTop: s.t === 'title' ? '26%' : 0,
        }}
      />
      {s.t === 'bullets' ? (
        <>
          <div style={{ height: 3, width: '80%', background: '#9a958a', borderRadius: 2 }} />
          <div style={{ height: 3, width: '72%', background: '#9a958a', borderRadius: 2 }} />
          <div style={{ height: 3, width: '64%', background: '#9a958a', borderRadius: 2 }} />
        </>
      ) : null}
      {s.t === 'chart' ? (
        <div className="flex items-end gap-1 flex-1 pb-0.5">
          {[40, 65, 50, 85, 70].map((h, i) => (
            <div
              key={i}
              style={{ width: 7, height: `${h}%`, background: i === 3 ? '#c96a47' : '#b8b2a4', borderRadius: 1 }}
            />
          ))}
        </div>
      ) : null}
      {s.t === 'two' ? (
        <div className="flex gap-1.5 flex-1">
          <div className="flex-1 rounded-sm" style={{ background: '#e4dfd2' }} />
          <div className="flex-1 rounded-sm" style={{ background: '#e4dfd2' }} />
        </div>
      ) : null}
    </div>
  );
}

export const SLIDES: SlideSketch[] = [
  { t: 'title', h: 'Q3 Business Review' },
  { t: 'bullets', h: 'Executive summary' },
  { t: 'chart', h: 'Revenue vs plan' },
  { t: 'two', h: 'Pipeline by segment' },
  { t: 'chart', h: 'Win rate — punchier' },
  { t: 'bullets', h: 'Risks & asks' },
];
