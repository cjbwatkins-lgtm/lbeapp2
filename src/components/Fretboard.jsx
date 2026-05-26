import { useState } from 'react';
import { FRETS, MARKERS, TUNINGS, ENHARMONICS, enharmonic, noteName, intervalName } from '../constants';

// ─── SINGLE FRET NOTE ──────────────────────────────────────────────────────
function Fret({ midi, lit, rootMidi, onClick, T, droning, customMode, stringIdx, fretIdx, droneActive, isMobile, showAllOctaves }) {
  const nn = noteName(midi);
  const flat = ENHARMONICS[nn];
  const [ripple, setRipple] = useState(0);
  let bg, border, txt, shadow, extraClass = "";

  if (customMode) {
    if (droning) {
      bg = `radial-gradient(circle,${T.ok}30,${T.bg2}e0)`; border = `2px solid ${T.ok}80`; txt = T.ok;
      shadow = `0 0 10px ${T.ok}40`;
      if (droneActive) extraClass = "lbe-chord-live";
    } else {
      bg = `${T.bg3}c0`; border = `1px solid ${T.line}60`; txt = T.muted; shadow = "none";
    }
  } else {
    const isLit = lit !== null && (showAllOctaves ? midi % 12 === lit % 12 : midi === lit);
    const isRoot = rootMidi !== null && (showAllOctaves ? midi % 12 === rootMidi % 12 : midi === rootMidi);
    if (isRoot) {
      bg = `radial-gradient(circle,${T.accent}30,${T.bg2}e0)`; border = `2px solid ${T.accent}80`;
      txt = T.accentGlow; shadow = `0 0 14px ${T.accent}50`;
    } else if (isLit) {
      bg = `radial-gradient(circle,${T.accent}18,${T.bg2}cc)`; border = `1.5px solid ${T.accent}40`;
      txt = T.accentGlow; shadow = `0 0 8px ${T.accent}30`;
    } else {
      bg = `${T.bg3}c0`; border = `1px solid ${T.line}60`; txt = T.muted; shadow = "none";
    }
  }

  const size = isMobile ? 38 : 30;
  const handleClick = () => { setRipple(r => r + 1); onClick(midi, stringIdx, fretIdx); };

  return (
    <button onClick={handleClick}
      className={`lbe-t relative flex flex-col items-center justify-center rounded-full ${extraClass} lbe-fret-touch`}
      style={{
        width: size, height: size, minWidth: size,
        background: bg, border, boxShadow: shadow,
        color: txt, lineHeight: 1, gap: 0, padding: 0, overflow: "visible",
      }}>
      {ripple > 0 && <span key={ripple} className="lbe-fret-ripple" />}
      {flat
        ? <><span style={{ fontSize: isMobile ? 8 : 7, fontWeight: 700, fontFamily: "monospace", lineHeight: 1 }}>{nn}</span>
            <span style={{ fontSize: isMobile ? 7 : 6, fontFamily: "monospace", lineHeight: 1, opacity: 0.7 }}>{flat}</span></>
        : <span className="font-bold font-mono leading-none" style={{ fontSize: isMobile ? 10 : 9 }}>{nn}</span>}
    </button>
  );
}

// ─── HORIZONTAL FRETBOARD (desktop / tablet) ────────────────────────────────
function HorizontalBoard({ count, lit, rootMidi, onFretClick, T, droningKeys, customMode, droneActive, showAllOctaves }) {
  const t = TUNINGS[count];
  const drSet = new Set(droningKeys || []);

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth: 700 }}>
        {/* Fret numbers */}
        <div className="flex" style={{ paddingLeft: 50, marginBottom: 4 }}>
          {Array.from({ length: FRETS }, (_, i) => (
            <div key={i} className="flex-shrink-0 text-center font-mono"
              style={{ width: i === 0 ? 38 : 42, fontSize: 8, color: MARKERS.has(i) ? T.sub : T.dim }}>
              {i === 0 ? "" : i}
            </div>
          ))}
        </div>
        {/* Strings */}
        <div className="flex flex-col" style={{ gap: 2 }}>
          {[...Array(count)].map((_, raw) => {
            const si = count - 1 - raw;
            const thick = 1 + raw * 0.35;
            return (
              <div key={si} className="flex items-center" style={{ height: 35 }}>
                <div className="flex-shrink-0 text-right pr-3 font-mono font-bold"
                  style={{ width: 46, fontSize: 11, color: T.sub }}>
                  {enharmonic(t.strings[si])}
                </div>
                <div className="flex relative items-center" style={{ height: 35 }}>
                  <div className={`absolute left-0 right-0 pointer-events-none ${droneActive ? "lbe-string-live" : "lbe-string-rest"}`}
                    style={{
                      top: "50%", height: Math.max(2, thick), transform: "translateY(-50%)",
                      background: `linear-gradient(90deg,${T.muted}28,${T.muted}10)`,
                      animationDelay: `${si * 300}ms`,
                    }} />
                  {Array.from({ length: FRETS }, (_, f) => {
                    const midi = t.midi[si] + f;
                    return (
                      <div key={f} className="flex-shrink-0 flex items-center justify-center relative z-10"
                        style={{ width: f === 0 ? 38 : 42, height: 35, borderLeft: f === 1 ? `3px solid ${T.muted}50` : f > 1 ? `1px solid ${T.line}35` : "none" }}>
                        <Fret midi={midi} lit={lit} rootMidi={rootMidi} onClick={onFretClick} T={T}
                          droning={drSet.has(`${si}-${f}`)} customMode={customMode}
                          stringIdx={si} fretIdx={f} droneActive={droneActive} isMobile={false}
                          showAllOctaves={showAllOctaves} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {/* Fret markers */}
        <div className="flex" style={{ paddingLeft: 50, marginTop: 6 }}>
          {Array.from({ length: FRETS }, (_, i) => (
            <div key={i} className="flex-shrink-0 flex justify-center" style={{ width: i === 0 ? 38 : 42, height: 10 }}>
              {MARKERS.has(i) && i !== 12 && <div className="rounded-full" style={{ width: 4, height: 4, background: T.dim + "60" }} />}
              {i === 12 && (
                <div className="flex gap-1.5">
                  <div className="rounded-full" style={{ width: 4, height: 4, background: T.sub + "60" }} />
                  <div className="rounded-full" style={{ width: 4, height: 4, background: T.sub + "60" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── VERTICAL FRETBOARD (mobile) ────────────────────────────────────────────
// Strings run left-to-right (low to high), frets run top-to-bottom
function VerticalBoard({ count, lit, rootMidi, onFretClick, T, droningKeys, customMode, droneActive, showAllOctaves }) {
  const t = TUNINGS[count];
  const drSet = new Set(droningKeys || []);
  const fretCount = 13; // Show fewer frets on mobile (0-12)

  return (
    <div className="w-full overflow-y-auto" style={{ maxHeight: "60vh" }}>
      {/* String labels */}
      <div className="flex justify-around px-2 mb-2" style={{ paddingLeft: 28 }}>
        {t.strings.map((s, si) => (
          <div key={si} className="text-center font-mono font-bold"
            style={{ fontSize: 11, color: T.sub, flex: 1, maxWidth: 52 }}>
            {enharmonic(s)}
          </div>
        ))}
      </div>
      {/* Fret rows */}
      <div className="flex flex-col" style={{ gap: 1 }}>
        {Array.from({ length: fretCount }, (_, f) => (
          <div key={f} className="flex items-center" style={{
            borderTop: f === 1 ? `3px solid ${T.muted}50` : f > 1 ? `1px solid ${T.line}35` : "none",
            minHeight: 44,
          }}>
            {/* Fret number */}
            <div className="flex-shrink-0 text-center font-mono"
              style={{ width: 26, fontSize: 9, color: MARKERS.has(f) ? T.sub : T.dim }}>
              {f === 0 ? "○" : f}
            </div>
            {/* Notes across strings */}
            <div className="flex justify-around flex-1">
              {t.strings.map((_, si) => {
                const midi = t.midi[si] + f;
                return (
                  <div key={si} className="flex items-center justify-center" style={{ flex: 1, maxWidth: 52 }}>
                    <Fret midi={midi} lit={lit} rootMidi={rootMidi} onClick={onFretClick} T={T}
                      droning={drSet.has(`${si}-${f}`)} customMode={customMode}
                      stringIdx={si} fretIdx={f} droneActive={droneActive} isMobile={true}
                      showAllOctaves={showAllOctaves} />
                  </div>
                );
              })}
            </div>
            {/* Fret marker */}
            <div className="flex-shrink-0 flex justify-center" style={{ width: 16 }}>
              {MARKERS.has(f) && f !== 12 && <div className="rounded-full" style={{ width: 4, height: 4, background: T.dim + "60" }} />}
              {f === 12 && (
                <div className="flex flex-col gap-1">
                  <div className="rounded-full" style={{ width: 4, height: 4, background: T.sub + "60" }} />
                  <div className="rounded-full" style={{ width: 4, height: 4, background: T.sub + "60" }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BOARD ───────────────────────────────────────────────────────────────────
export function Board({ count, lit, rootMidi, onFretClick, T, droningKeys, customMode, droneActive, showAllOctaves }) {
  return <HorizontalBoard count={count} lit={lit} rootMidi={rootMidi} onFretClick={onFretClick}
    T={T} droningKeys={droningKeys} customMode={customMode} droneActive={droneActive}
    showAllOctaves={showAllOctaves} />;
}
