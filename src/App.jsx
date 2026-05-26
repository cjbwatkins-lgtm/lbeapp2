import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Engine } from './engine/Engine.js';
import {
  NOTES, ENHARMONICS, INTERVALS, enharmonic, TEXTURES, noteName, noteIdx, intervalName, pad2,
  TUNINGS, FRETS,
  TIME_SIGS, SUBDIV_OPTS, SUBDIV_LABELS, ACCENT_CYCLE, ACCENT_LABELS, CLICK_MODES, CLICK_LABELS,
  CLAVE_44, CLAVE_44_PULSE, CLAVE_44_STEPS, CLAVE_68, CLAVE_68_PULSE, CLAVE_68_STEPS,
  FOCUS_MODES, DARK, LIGHT,
} from './constants';
import {
  useMetronome, useTapTempo, useFocusTimer, useWakeLock, useResponsive,
} from './hooks';
import { Pill, PtrSlider, HSlider, BPMKnob, ToneKnob, SL, FocusRing, Board } from './components';

// ─── STABLE MODULE-LEVEL COMPONENTS ──────────────────────────────────────────
// Defined outside App so their reference never changes — prevents React from
// unmounting/remounting panels on every re-render (which would reset scroll).

const _onFocusScrollLock = (e) => {
  const el = e.currentTarget;
  const top = el.scrollTop;
  requestAnimationFrame(() => { el.scrollTop = top; });
};

function DragHandle({ id, onDown, T }) {
  return (
    <div
      onMouseDown={(e) => onDown(id, e)}
      style={{
        width: 20, height: 20, cursor: "grab",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: T.txt + "80", fontSize: 12, userSelect: "none",
      }}
    >
      ⋮⋮
    </div>
  );
}

function PanelWrap({ id, children, title, panelRefs, T, overId, dragId, onDown }) {
  return (
    <div
      ref={(el) => { if (el) panelRefs.current[id] = el; }}
      onFocus={_onFocusScrollLock}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: 12,
        background: T.bg2,
        border: `1px solid ${overId === id ? T.ok + "80" : T.txt + "20"}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflow: "auto",
        opacity: dragId === id ? 0.4 : 1,
        transition: dragId ? "none" : "opacity 200ms, border-color 150ms",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <DragHandle id={id} onDown={onDown} T={T} />
        <span style={{ fontSize: 12, fontWeight: 600, color: T.txt, flex: 1 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── CHORD / INTERVAL DISPLAY HELPERS ────────────────────────────────────────

const CHORD_NAMES_MAP = {
  '3,7': 'minor',   '4,7': 'major',   '3,6': 'dim',      '4,8': 'aug',
  '2,7': 'sus2',    '5,7': 'sus4',
  '3,7,10': 'm7',   '4,7,10': '7',    '4,7,11': 'maj7',  '3,7,11': 'm(maj7)',
  '3,6,10': 'm7♭5', '3,6,9':  'dim7', '4,8,10': 'aug7',  '4,8,11': '+maj7',
  '4,7,9':  '6',    '3,7,9':  'm6',
  '2,4,7':  'add9', '2,4,7,10': '9',  '2,4,7,11': 'maj9',
};

function describeHarmony(root, harmonies) {
  const harms = harmonies.filter(Boolean);
  const rootDisplay = enharmonic(root);
  if (harms.length === 0) return rootDisplay;
  const rootIdx = NOTES.indexOf(root);
  const semis = [...new Set(
    harms.map(n => ((NOTES.indexOf(n) - rootIdx + 12) % 12)).filter(i => i > 0)
  )].sort((a, b) => a - b);
  if (semis.length === 0) return rootDisplay;
  if (semis.length === 1) {
    const harmDisplay = [...new Set(harms.map(enharmonic))].join('/');
    return `${rootDisplay} + ${harmDisplay} · ${INTERVALS[semis[0]]}`;
  }
  const key = semis.join(',');
  if (CHORD_NAMES_MAP[key]) return `${rootDisplay} ${CHORD_NAMES_MAP[key]}`;
  return [root, ...harms].map(enharmonic).join(' · ');
}

function describeCustom(activeNotes) {
  if (activeNotes.length === 0) return null;
  if (activeNotes.length === 1) return enharmonic(activeNotes[0]);
  if (activeNotes.length === 2) {
    const idx = activeNotes.map(n => NOTES.indexOf(n)).sort((a, b) => a - b);
    const semi = (idx[1] - idx[0] + 12) % 12;
    return `${activeNotes.map(enharmonic).join(' + ')} · ${INTERVALS[semi]}`;
  }
  return activeNotes.map(enharmonic).join(' · ');
}

export default function App() {
  // ============================================================================
  // STATE & CONSTANTS
  // ============================================================================

  // Responsive — scale entire app to fit any window
  const APP_W = 960;
  const { width: winW, height: winH } = useResponsive();
  const appScale = Math.min(1, winW / APP_W);
  const appH = winH / appScale;
  const wakeLock = useWakeLock();

  // Theme
  const [theme, setTheme] = useState("dark");
  const T = theme === "dark" ? DARK : LIGHT;

  // Engine
  const eng = useRef(null);
  const [ready, setReady] = useState(false);

  // Fretboard
  const [strings, setStrings] = useState(4);
  const [lit, setLit] = useState(null);
  const [showAllOctaves, setShowAllOctaves] = useState(false);

  // Drone
  const [droneOn, setDroneOn] = useState(false);
  const [drRoot, setDrRoot] = useState("E");
  const [drOct, setDrOct] = useState(2);
  const [drTex, setDrTex] = useState("bassGuitar");
  const [selectedIntervals, setSelectedIntervals] = useState([]);
  const [drMode, setDrMode] = useState("harmony");
  const [customNotes, setCustomNotes] = useState([]);

  // Metronome
  const [metOn, setMetOn] = useState(false);
  const [bpm, setBpm] = useState(90);
  const [timeSig, setTimeSig] = useState({ n: 4, d: 4, label: "4/4" });
  const [subdiv, setSubdiv] = useState("none");
  const [clickMode, setClickMode] = useState("all");
  const [customAccents, setCustomAccents] = useState([2, 1, 1, 1]);
  const [beatEmphasis, setBeatEmphasis] = useState(() => new Array(4).fill(0));
  const [gapBars, setGapBars] = useState(0);
  const [gapSilent, setGapSilent] = useState(0);
  const [rampMode, setRampMode] = useState("off");
  const [rampEnd, setRampEnd] = useState(140);
  const [rampBars, setRampBars] = useState(32);
  const [countIn, setCountIn] = useState(false);

  // Clave
  const [claveMode, setClaveMode] = useState(false);
  const [claveFeel, setClaveFeel] = useState("44");
  const [claveType, setClaveType] = useState("son");
  const [claveDir, setClaveDir] = useState("32");
  const [clave68Pat, setClave68Pat] = useState("clave68");
  const [clavePulse, setClavePulse] = useState(false);
  const [claveCountIn, setClaveCountIn] = useState(false);

  // Mix
  const [volMaster, setVolMaster] = useState(0.75);
  const [volDrone, setVolDrone] = useState(0.55);
  const [volMet, setVolMet] = useState(0.50);

  // Noise
  const [noiseOn, setNoiseOn] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState(0.03);
  const [noiseTone, setNoiseTone] = useState(0);

  // Tone shaping
  const [droneTone, setDroneTone] = useState(0);
  const [metTone, setMetTone] = useState(0);

  // Panels & UI
  const [panelOrder, setPanelOrder] = useState(["fretboard", "drone", "metro", "mixer"]);
  const [view, setView] = useState("lab");
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  // Global pause
  const [globalPause, setGlobalPause] = useState(false);
  const [pauseElapsed, setPauseElapsed] = useState(0);

  // Beat display (live, from metronome callback)
  const [beatDisplay, setBeatDisplay] = useState({ beat: 0, bar: 1, status: "" });

  // Focus view state
  const [confirmReset, setConfirmReset] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [customWork, setCustomWork] = useState(20);
  const [customBreak, setCustomBreak] = useState(5);

  // Animations
  const [sunline, setSunline] = useState(false);
  const [justStarted, setJustStarted] = useState(false);

  // PWA update
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // ============================================================================
  // REFS
  // ============================================================================

  const mounted = useRef(false);
  const panelOrderRef = useRef(panelOrder);
  const panelRefs = useRef({});
  const dragState = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const overIdRef = useRef(null);
  const metroBeatRef = useRef(0);
  const metroBarRef = useRef(0);
  const metroStatusRef = useRef("");
  const preBreak = useRef({ droneOn: false, metOn: false, noiseOn: false });
  const prevPhase = useRef(null);
  const droneOnRef = useRef(droneOn);
  const metOnRef = useRef(metOn);
  const noiseOnRef = useRef(noiseOn);
  const metConfigRef = useRef(null);
  const chimeRootRef = useRef(drRoot);
  const drOctRef = useRef(drOct);
  const pauseStartRef = useRef(null);
  const prePause = useRef({ droneOn: false, metOn: false, noiseOn: false });
  const globalPausedTimer = useRef(false);

  const dragOverlayRef = useRef(null);
  const focusTimer = useFocusTimer();

  // ============================================================================
  // THEME SWITCH
  // ============================================================================

  const switchTheme = useCallback(() => {
    setSunline(true);
    setTimeout(() => {
      setTheme(t => t === "dark" ? "light" : "dark");
      setTimeout(() => setSunline(false), 150);
    }, 150);
  }, []);

  // ============================================================================
  // BOOT
  // ============================================================================

  const boot = useCallback(async () => {
    if (mounted.current) return;
    mounted.current = true;

    try {
      const engine = new Engine();
      await engine.init();
      eng.current = engine;
      if (metCbRef.current) engine.setMetronomeCallback(metCbRef.current);
      setReady(true);
    } catch (e) {
      console.error("Engine init failed:", e);
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // ============================================================================
  // MASTER VOLUME & BUS LEVELS
  // ============================================================================

  useEffect(() => {
    if (!eng.current) return;
    eng.current.setMasterVolume(volMaster);
  }, [volMaster]);

  useEffect(() => {
    if (!eng.current) return;
    eng.current.setDroneVolume(volDrone);
  }, [volDrone]);

  useEffect(() => {
    if (!eng.current) return;
    eng.current.setMetVolume(volMet);
  }, [volMet]);

  useEffect(() => {
    if (!eng.current) return;
    eng.current.setDroneTone(droneTone);
  }, [droneTone]);

  useEffect(() => {
    if (!eng.current) return;
    eng.current.setMetTone(metTone);
  }, [metTone]);

  // ============================================================================
  // NOISE LIFECYCLE
  // ============================================================================

  useEffect(() => {
    noiseOnRef.current = noiseOn;
    if (!eng.current) return;
    if (noiseOn) {
      eng.current.startNoise(noiseLevel, noiseTone);
    } else {
      eng.current.stopNoise();
    }
  }, [noiseOn, noiseLevel, noiseTone]);

  // ============================================================================
  // NOISE ROOT TUNING — tracks drone root so noise resonance stays in key
  // ============================================================================

  useEffect(() => {
    if (!eng.current || !noiseOn) return;
    const rootMidi = noteIdx(drRoot) + 12 * (drOct + 1);
    const freq = 440 * Math.pow(2, (rootMidi - 69) / 12);
    eng.current.setNoiseRoot(droneOn ? freq : 0);
  }, [drRoot, drOct, droneOn, noiseOn]);

  // ============================================================================
  // DRONE LIFECYCLE
  // ============================================================================

  const drHarm = useMemo(() => {
    if (drMode !== "harmony" || selectedIntervals.length === 0) return [];
    const rootIdx = NOTES.indexOf(drRoot);
    return [...new Set(selectedIntervals)].map(semi => NOTES[(rootIdx + semi + 12) % 12]);
  }, [selectedIntervals, drRoot, drMode]);

  useEffect(() => {
    droneOnRef.current = droneOn;
    if (!eng.current) return;
    if (!droneOn) eng.current.stopDrone();
  }, [droneOn]);

  useEffect(() => {
    if (!eng.current || !droneOnRef.current) return;
    if (drMode === "custom" && customNotes.length === 0) {
      eng.current.stopDrone();
      return;
    }
    const notes = drMode === "custom" ? customNotes : drHarm;
    eng.current.startDrone(drRoot, drOct, drTex, notes, drMode);
  }, [drRoot, drOct, drTex, drHarm, drMode, customNotes]);

  // ============================================================================
  // METRONOME CONFIG & LIFECYCLE
  // ============================================================================

  useEffect(() => {
    const config = {
      bpm,
      n: timeSig.n,
      d: timeSig.d,
      subdiv,
      clickMode,
      customAccents,
      beatEmphasis,
      gapBars,
      gapSilent,
      rampMode,
      rampEnd,
      rampBars,
      countIn,
      clave: claveMode ? {
        feel: claveFeel,
        type: claveType,
        dir: claveDir,
        pat68: clave68Pat,
        pulse: clavePulse,
        countIn: claveCountIn,
      } : null,
    };
    metConfigRef.current = config;
    if (metOn && eng.current) {
      eng.current.configMetronome(config);
    }
  }, [bpm, timeSig, subdiv, clickMode, customAccents, beatEmphasis, gapBars, gapSilent, rampMode, rampEnd, rampBars, countIn, claveMode, claveFeel, claveType, claveDir, clave68Pat, clavePulse, claveCountIn]);

  useEffect(() => {
    metOnRef.current = metOn;
    if (!eng.current) return;

    if (metOn) {
      if (metConfigRef.current) {
        eng.current.configMetronome(metConfigRef.current);
      }
      eng.current.startMetronome();
    } else {
      eng.current.stopMetronome();
    }
  }, [metOn]);

  // ============================================================================
  // GLOBAL PAUSE / RESUME
  // ============================================================================

  useEffect(() => {
    if (!eng.current) return;

    if (globalPause) {
      preBreak.current = { droneOn: droneOnRef.current, metOn: metOnRef.current, noiseOn: noiseOnRef.current };
      eng.current.pauseAll();
      pauseStartRef.current = Date.now();
      setPauseElapsed(0);
      const timerActive = ["work", "break"].includes(focusTimer.phase) && !focusTimer.isPaused;
      globalPausedTimer.current = timerActive;
      if (timerActive) focusTimer.pause();
    } else {
      eng.current.resumeAll();
      if (globalPausedTimer.current) {
        globalPausedTimer.current = false;
        focusTimer.resume();
      }
    }
  }, [globalPause, focusTimer]);

  useEffect(() => {
    if (!globalPause) return;
    const id = setInterval(() => {
      setPauseElapsed(Math.floor((Date.now() - (pauseStartRef.current || Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [globalPause]);

  // ============================================================================
  // BREAK PAUSE/RESUME (Focus Timer)
  // ============================================================================

  useEffect(() => {
    const phase = focusTimer.phase;
    if (phase === prevPhase.current) return;

    const rootMidi = noteIdx(chimeRootRef.current) + 12 * (drOctRef.current + 1);

    if (phase === "work_done") {
      // Session complete — save audio state, stop everything, play reward chord
      prePause.current = {
        droneOn: droneOnRef.current,
        metOn: metOnRef.current,
        noiseOn: noiseOnRef.current,
      };
      if (droneOnRef.current) setDroneOn(false);
      if (metOnRef.current) setMetOn(false);
      if (noiseOnRef.current) setNoiseOn(false);
      eng.current?.playCycleChime(rootMidi);
    } else if (phase === "break") {
      // User confirmed break — play a settling descending phrase
      eng.current?.playBreakChime(rootMidi);
    } else if (phase === "break_done") {
      // Break over — play rising phrase signalling readiness
      eng.current?.playResumeChime(rootMidi);
    } else if (phase === "work" && (prevPhase.current === "break_done" || prevPhase.current === "break")) {
      // User started next session — restore audio
      if (prePause.current.droneOn) setDroneOn(true);
      if (prePause.current.metOn) setMetOn(true);
      if (prePause.current.noiseOn) setNoiseOn(true);
    }
    prevPhase.current = phase;
  }, [focusTimer.phase]);

  // ============================================================================
  // VISIBILITY CHANGE - SUSPEND/RESUME AudioContext
  // ============================================================================

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (eng.current?.ctx?.state === 'running') {
          eng.current.ctx.suspend();
        }
      } else {
        if (eng.current?.ctx?.state === 'suspended') {
          eng.current.ctx.resume();
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ============================================================================
  // WAKE LOCK - KEEP SCREEN ON WHEN AUDIO IS ACTIVE
  // ============================================================================

  useEffect(() => {
    if (droneOn || metOn || noiseOn) {
      wakeLock.request();
    } else {
      wakeLock.release();
    }
  }, [droneOn, metOn, noiseOn]);

  // ============================================================================
  // PWA UPDATE LISTENER
  // ============================================================================

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      });
    }
  }, []);

  // ============================================================================
  // TIMESIG CHANGE - UPDATE ACCENT LENGTH
  // ============================================================================

  useEffect(() => {
    const n = timeSig.n;
    if (customAccents.length !== n) {
      const newAccents = new Array(n).fill(1);
      newAccents[0] = 2;
      setCustomAccents(newAccents);

      const newEmphasis = new Array(n).fill(0);
      setBeatEmphasis(newEmphasis);
    }
  }, [timeSig.n, customAccents.length]);

  // ============================================================================
  // REF UPDATES FOR FRETBOARD STATE
  // ============================================================================

  useEffect(() => {
    panelOrderRef.current = panelOrder;
  }, [panelOrder]);

  useEffect(() => {
    chimeRootRef.current = drRoot;
  }, [drRoot]);

  useEffect(() => {
    drOctRef.current = drOct;
  }, [drOct]);

  // ============================================================================
  // DRONING KEYS — fret positions for custom drone highlighting
  // ============================================================================

  const droningKeys = useMemo(() => {
    if (drMode !== "custom" || customNotes.length === 0) return new Set();
    const tuning = TUNINGS[strings];
    if (!tuning) return new Set();
    const midiSet = new Set(customNotes);
    const noteClasses = new Set(customNotes.map(m => ((m % 12) + 12) % 12));
    const keys = new Set();
    tuning.midi.forEach((openMidi, si) => {
      for (let fi = 0; fi < FRETS; fi++) {
        const fretMidi = openMidi + fi;
        const matches = showAllOctaves
          ? noteClasses.has(((fretMidi % 12) + 12) % 12)
          : midiSet.has(fretMidi);
        if (matches) keys.add(`${si}-${fi}`);
      }
    });
    return keys;
  }, [customNotes, strings, drMode, showAllOctaves]);

  // ============================================================================
  // FRETBOARD CALLBACK
  // ============================================================================

  const onFret = useCallback((midi) => {
    if (drMode === "custom") {
      setCustomNotes(prev =>
        prev.includes(midi) ? prev.filter(m => m !== midi) : [...prev, midi]
      );
    } else {
      const newRoot = NOTES[((midi % 12) + 12) % 12];
      const oct = Math.floor(midi / 12) - 1;
      const newOct = (oct >= 1 && oct <= 4) ? oct : drOct;
      setDrRoot(newRoot);
      if (oct >= 1 && oct <= 4) setDrOct(oct);
      if (eng.current) eng.current.playChime(midi % 12, 1.0);
      // Only direct-call when root/oct are unchanged — otherwise the effect fires
      // with a freshly recomputed drHarm, which is what we want for harmony mode.
      if (droneOnRef.current && eng.current && newRoot === drRoot && newOct === drOct) {
        eng.current.startDrone(newRoot, newOct, drTex, drHarm, drMode);
      }
      setLit(midi);
      setTimeout(() => setLit(null), 600);
    }
  }, [drMode, drOct, drRoot, drTex, drHarm]);

  // ============================================================================
  // TOGGLE HARMONY
  // ============================================================================

  const clearHarm = useCallback(() => setSelectedIntervals([]), []);

  // ============================================================================
  // CYCLE ACCENTS
  // ============================================================================

  const cycleAccent = useCallback((i) => {
    setCustomAccents(prev => {
      const arr = [...prev];
      arr[i] = (arr[i] + 1) % 3;
      return arr;
    });
  }, []);

  // ============================================================================
  // TOGGLE METRONOME
  // ============================================================================

  const toggleMet = useCallback(() => {
    setMetOn(prev => !prev);
  }, []);

  // ============================================================================
  // ALL OFF
  // ============================================================================

  const allOff = useCallback(() => {
    setDroneOn(false);
    setMetOn(false);
    setNoiseOn(false);
    focusTimer.stop();
    setGlobalPause(false);
  }, [focusTimer]);

  // ============================================================================
  // PAUSE ALL / RESUME PRACTICE
  // ============================================================================

  const pauseAll = useCallback(() => {
    setGlobalPause(true);
  }, []);

  const resumePractice = useCallback(() => {
    if (globalPause) {
      const elapsed = (Date.now() - (pauseStartRef.current || Date.now())) / 1000;
      setPauseElapsed(elapsed);
    }
    setGlobalPause(false);
  }, [globalPause]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      e.preventDefault();
      setGlobalPause(p => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ============================================================================
  // DRAG & DROP
  // ============================================================================

  const onHandleDown = useCallback((id, e) => {
    e.preventDefault();
    overIdRef.current = null;
    setDragId(id);
  }, []);

  // ============================================================================
  // METRONOME CALLBACK (with visual updates)
  // ============================================================================

  const metCbRef = useRef(null);
  useEffect(() => {
    metCbRef.current = (beat, bar, phase) => {
      metroBeatRef.current = beat;
      metroBarRef.current = bar;

      const isClave = claveMode && phase && (phase.clave === 1 || phase.clave === 2);
      const claveLabel = isClave ? (phase.clave === 1 ? "son" : "rumba") : "";

      let status = "";
      if (rampMode !== "off" && phase && phase.rampBpm) {
        status = `${phase.rampBpm} BPM`;
      }

      metroStatusRef.current = { beat, bar, status, clave: claveLabel };
      setBeatDisplay({ beat, bar, status });
    };

    if (eng.current && metCbRef.current) {
      eng.current.setMetronomeCallback(metCbRef.current);
    }
  }, [claveMode]);

  // ============================================================================
  // PANEL RENDERERS
  // ============================================================================

  const renderFretboard = () => (
    <PanelWrap id="fretboard" title="Fretboard" {...pp}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: T.txt + "80", flexShrink: 0 }}>Strings</span>
        <div style={{ flex: 1, fontSize: 11, color: T.txt + "80" }}>
          {[4, 5, 6].map(n => (
            <button
              key={n}
              onClick={() => setStrings(n)}
              style={{
                padding: "4px 8px",
                margin: "0 2px",
                background: strings === n ? T.ok : T.txt + "20",
                color: strings === n ? T.bg : T.txt,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 10,
                fontWeight: strings === n ? 600 : 400,
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAllOctaves(v => !v)}
          style={{
            padding: "4px 8px",
            background: showAllOctaves ? T.accent + "22" : "transparent",
            border: `1px solid ${showAllOctaves ? T.accent + "70" : T.line}`,
            borderRadius: 4,
            color: showAllOctaves ? T.accent : T.muted,
            fontSize: 10,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: "inherit",
          }}
        >
          {showAllOctaves ? "All Oct." : "Exact"}
        </button>
      </div>
      <Board
        count={strings}
        lit={lit}
        rootMidi={droneOn ? noteIdx(drRoot) + 12 * (drOct + 1) : null}
        onFretClick={onFret}
        T={T}
        customMode={drMode === "custom"}
        droningKeys={droningKeys}
        droneActive={droneOn}
        showAllOctaves={showAllOctaves}
      />
    </PanelWrap>
  );

  const renderDrone = () => (
    <PanelWrap id="drone" title="Drone" {...pp}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Pill active={droneOn} onClick={() => setDroneOn(!droneOn)} T={T}>
          Drone
        </Pill>
        <ToneKnob value={droneTone} onChange={v => { setDroneTone(v); if (eng.current) eng.current.setDroneTone(v); }} label="Tone" T={T} />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Texture</label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {Object.keys(TEXTURES).map(tex => (
            <button
              key={tex}
              onClick={() => setDrTex(tex)}
              style={{
                padding: "4px 8px",
                background: drTex === tex ? T.ok : T.txt + "20",
                color: drTex === tex ? T.bg : T.txt,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 9,
                fontWeight: drTex === tex ? 600 : 400,
              }}
            >
              {TEXTURES[tex].name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Mode</label>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "root", label: "Root" },
            { id: "harmony", label: "Harmony" },
            { id: "custom", label: "Custom" },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setDrMode(id); if (droneOn) setDroneOn(false); }}
              style={{
                padding: "4px 12px",
                background: drMode === id ? T.ok : T.txt + "20",
                color: drMode === id ? T.bg : T.txt,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 10,
                fontWeight: drMode === id ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Harmony: chord presets + interval toggles */}
      {drMode === "harmony" && (
        <div style={{ marginTop: 6 }}>
          {/* Triads */}
          <label style={{ fontSize: 9, color: T.dim, marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: "0.1em" }}>Triads</label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {[
              { label: "Maj",     semis: [4, 7] },
              { label: "min",     semis: [3, 7] },
              { label: "dim",     semis: [3, 6] },
              { label: "aug",     semis: [4, 8] },
              { label: "sus2",    semis: [2, 7] },
              { label: "sus4",    semis: [5, 7] },
            ].map(({ label, semis }) => {
              const active = semis.length === selectedIntervals.length && semis.every(s => selectedIntervals.includes(s));
              return (
                <button key={label} onClick={() => setSelectedIntervals(semis)}
                  style={{
                    padding: "4px 10px",
                    background: active ? T.accent + "22" : T.txt + "18",
                    color: active ? T.accent : T.txt,
                    border: `1px solid ${active ? T.accent + "70" : T.txt + "25"}`,
                    borderRadius: 4, cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400,
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
          {/* Seventh chords */}
          <label style={{ fontSize: 9, color: T.dim, marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: "0.1em" }}>Sevenths</label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {[
              { label: "maj7",    semis: [4, 7, 11] },
              { label: "7",       semis: [4, 7, 10] },
              { label: "m7",      semis: [3, 7, 10] },
              { label: "m(maj7)", semis: [3, 7, 11] },
              { label: "ø7",      semis: [3, 6, 10] },
              { label: "°7",      semis: [3, 6,  9] },
              { label: "aug7",    semis: [4, 8, 10] },
              { label: "+maj7",   semis: [4, 8, 11] },
            ].map(({ label, semis }) => {
              const active = semis.length === selectedIntervals.length && semis.every(s => selectedIntervals.includes(s));
              return (
                <button key={label} onClick={() => setSelectedIntervals(semis)}
                  style={{
                    padding: "4px 10px",
                    background: active ? T.accent + "22" : T.txt + "18",
                    color: active ? T.accent : T.txt,
                    border: `1px solid ${active ? T.accent + "70" : T.txt + "25"}`,
                    borderRadius: 4, cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400,
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
          {/* Individual interval toggles */}
          <label style={{ fontSize: 9, color: T.dim, marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: "0.1em" }}>Intervals</label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[1,2,3,4,5,6,7,8,9,10,11].map(semi => {
              const on = selectedIntervals.includes(semi);
              return (
                <button key={semi}
                  onClick={() => setSelectedIntervals(prev =>
                    prev.includes(semi) ? prev.filter(s => s !== semi) : [...prev, semi]
                  )}
                  style={{
                    padding: "4px 9px",
                    background: on ? T.ok + "22" : T.txt + "18",
                    color: on ? T.ok : T.txt,
                    border: `1px solid ${on ? T.ok + "70" : T.txt + "25"}`,
                    borderRadius: 4, cursor: "pointer", fontSize: 9, fontWeight: on ? 700 : 400,
                  }}>
                  {INTERVALS[semi]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom: fretboard-only label */}
      {drMode === "custom" && (
        <div style={{ fontSize: 9, color: T.dim, marginTop: 2 }}>
          Tap fretboard notes to build the chord
          {customNotes.length > 0 && (
            <button onClick={() => setCustomNotes([])} style={{ marginLeft: 10, fontSize: 9, color: T.dim, background: "transparent", border: `1px solid ${T.line}40`, borderRadius: 3, padding: "1px 7px", cursor: "pointer" }}>
              clear
            </button>
          )}
        </div>
      )}

      {/* Sounding display */}
      {(drMode === "harmony" || drMode === "custom") && (
        <div style={{ padding: "8px 12px", background: T.bg3, borderRadius: 6, border: `1px solid ${T.line}45` }}>
          <div style={{ fontSize: 8, color: T.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.12em" }}>Sounding</div>
          <div style={{ fontSize: 17, color: drMode === "harmony" ? T.accent : T.ok, fontFamily: "monospace", fontWeight: 700 }}>
            {drMode === "harmony"
              ? describeHarmony(drRoot, drHarm)
              : (describeCustom([...new Set(customNotes.map(m => NOTES[((m % 12) + 12) % 12]))]) || <span style={{ color: T.dim }}>—</span>)
            }
          </div>
          {drMode === "harmony" && selectedIntervals.length > 0 && (
            <button onClick={clearHarm} style={{ marginTop: 5, fontSize: 9, color: T.dim, background: "transparent", border: `1px solid ${T.line}40`, borderRadius: 3, padding: "1px 7px", cursor: "pointer" }}>
              clear intervals
            </button>
          )}
        </div>
      )}
    </PanelWrap>
  );

  const renderMetro = () => (
    <PanelWrap id="metro" title="Metronome" {...pp}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill active={metOn} onClick={toggleMet} T={T}>
          Metronome
        </Pill>
        <ToneKnob value={metTone} onChange={v => { setMetTone(v); if (eng.current) eng.current.setMetTone(v); }} label="Tone" T={T} color={T.accent} />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {customAccents.map((acc, i) => {
            const isActive = metOn && beatDisplay.beat === i;
            return (
              <button
                key={i}
                onClick={() => cycleAccent(i)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <div
                  key={isActive ? `a-${beatDisplay.bar}-${i}` : `idle-${i}`}
                  className={isActive ? (acc === 2 ? "lbe-beat-dot" : acc === 1 ? "lbe-beat-dot-sub" : "lbe-beat-dot-ghost") : ""}
                  style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: isActive
                      ? (acc === 2 ? T.accent + "80" : acc === 1 ? T.ok + "60" : T.line + "20")
                      : (acc === 2 ? T.accent + "28" : acc === 1 ? T.txt + "18" : "transparent"),
                    border: `1.5px solid ${
                      isActive ? (acc === 2 ? T.accent : acc === 1 ? T.ok : T.line + "60")
                               : (acc === 2 ? T.accent + "90" : acc === 1 ? T.line2 : T.line + "40")
                    }`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9,
                    color: isActive
                      ? (acc === 2 ? T.accent : acc === 1 ? T.ok : T.dim)
                      : (acc === 2 ? T.accent + "cc" : acc === 1 ? T.sub : T.dim + "60"),
                    fontWeight: acc === 2 ? 700 : 400,
                    transition: "background 60ms ease, border-color 60ms ease",
                    opacity: acc === 0 ? (isActive ? 0.55 : 0.3) : 1,
                  }}
                >
                  {i + 1}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexDirection: "row", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>BPM</label>
          <BPMKnob
            value={bpm}
            min={20}
            max={320}
            onChange={setBpm}
            T={T}
          />
          <div style={{ marginTop: 8, textAlign: "center", fontSize: 14, fontWeight: 600, color: T.ok }}>
            {bpm}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Time Sig</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {TIME_SIGS.map(ts => (
              <button
                key={ts.label}
                onClick={() => setTimeSig(ts)}
                style={{
                  padding: "6px 4px",
                  background: timeSig.label === ts.label ? T.ok : T.txt + "20",
                  color: timeSig.label === ts.label ? T.bg : T.txt,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: timeSig.label === ts.label ? 600 : 400,
                }}
              >
                {ts.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Subdivision</label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SUBDIV_OPTS.map(opt => (
            <button
              key={opt}
              onClick={() => setSubdiv(opt)}
              style={{
                padding: "4px 8px",
                background: subdiv === opt ? T.ok : T.txt + "20",
                color: subdiv === opt ? T.bg : T.txt,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 9,
                fontWeight: subdiv === opt ? 600 : 400,
              }}
            >
              {SUBDIV_LABELS[opt] ?? opt}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Click Mode</label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {CLICK_MODES.map(cm => (
            <button
              key={cm}
              onClick={() => setClickMode(cm)}
              style={{
                padding: "4px 8px",
                background: clickMode === cm ? T.ok : T.txt + "20",
                color: clickMode === cm ? T.bg : T.txt,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 9,
                fontWeight: clickMode === cm ? 600 : 400,
              }}
            >
              {CLICK_LABELS[cm] ?? cm}
            </button>
          ))}
        </div>
      </div>

      {/* Gap Training */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.txt}10` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <label style={{ fontSize: 10, color: T.txt + "80", fontWeight: 600 }}>Gap Training</label>
          {gapBars > 0 && gapSilent > 0 && (
            <span style={{ fontSize: 9, color: T.ok }}>{gapBars} on / {gapSilent} off</span>
          )}
        </div>
        <div style={{ fontSize: 9, color: T.dim, marginBottom: 8 }}>
          {gapBars > 0 && gapSilent > 0
            ? "Click drops out — keep the pulse going in the silence"
            : "Set both to activate — click drops out so you keep time on your own"}
        </div>
        {/* Prominent on/off counters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <div style={{ flex: 1, textAlign: "center", padding: "8px 0", background: T.bg3, borderRadius: 6, border: `1px solid ${gapBars > 0 ? T.ok + "50" : T.line}` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: gapBars > 0 ? T.ok : T.dim, lineHeight: 1 }}>{gapBars || "—"}</div>
            <div style={{ fontSize: 9, color: T.dim, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em" }}>bars on</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "8px 0", background: T.bg3, borderRadius: 6, border: `1px solid ${gapSilent > 0 ? T.warn + "50" : T.line}` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: gapSilent > 0 ? T.warn : T.dim, lineHeight: 1 }}>{gapSilent || "—"}</div>
            <div style={{ fontSize: 9, color: T.dim, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em" }}>bars off</div>
          </div>
        </div>
        <label style={{ fontSize: 9, color: T.txt + "60", marginBottom: 3, display: "block" }}>On</label>
        <HSlider value={gapBars} min={0} max={16} onChange={setGapBars} T={T} label={gapBars === 0 ? "off" : `${gapBars}`} />
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 9, color: T.txt + "60", marginBottom: 3, display: "block" }}>Off</label>
          <HSlider value={gapSilent} min={0} max={16} onChange={setGapSilent} T={T} label={gapSilent === 0 ? "off" : `${gapSilent}`} />
        </div>
      </div>

      {/* Tempo Ramp */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.txt}10` }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 2, display: "block", fontWeight: 600 }}>Tempo Ramp</label>
        <div style={{ fontSize: 9, color: T.dim, marginBottom: 6 }}>
          Gradually shift tempo while you play — set target BPM above or below current to speed up or slow down
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "off",    label: "Off" },
            { id: "linear", label: "Even" },
            { id: "expo",   label: "Accelerating" },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setRampMode(id)}
              style={{
                padding: "4px 10px",
                background: rampMode === id ? T.ok : T.txt + "20",
                color: rampMode === id ? T.bg : T.txt,
                border: "none", borderRadius: 4, cursor: "pointer", fontSize: 9,
                fontWeight: rampMode === id ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {rampMode !== "off" && (
        <>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 9, color: T.txt + "60", marginBottom: 3, display: "block" }}>
              Target BPM — {rampEnd}
            </label>
            <HSlider value={rampEnd} min={30} max={300} onChange={setRampEnd} T={T} label={`${rampEnd}`} />
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 9, color: T.txt + "60", marginBottom: 3, display: "block" }}>
              Change over (bars) — {rampBars}
            </label>
            <HSlider value={rampBars} min={1} max={64} onChange={setRampBars} T={T} label={`${rampBars}`} />
          </div>
        </>
      )}

      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setCountIn(!countIn)}
          style={{
            padding: "6px 12px",
            background: countIn ? T.ok : T.txt + "20",
            color: countIn ? T.bg : T.txt,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 10,
            fontWeight: countIn ? 600 : 400,
          }}
        >
          Count In
        </button>
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.txt}20` }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block", fontWeight: 600 }}>
          Clave
        </label>

        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setClaveMode(!claveMode)}
            style={{
              padding: "6px 12px",
              background: claveMode ? T.ok : T.txt + "20",
              color: claveMode ? T.bg : T.txt,
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: claveMode ? 600 : 400,
            }}
          >
            Enable Clave
          </button>
        </div>

        {claveMode && (
          <>
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 9, color: T.txt + "80", marginBottom: 4, display: "block" }}>Feel</label>
              <div style={{ display: "flex", gap: 4 }}>
                {[{ val: "44", label: "4/4" }, { val: "68", label: "6/8" }].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => setClaveFeel(val)}
                    style={{
                      padding: "4px 8px",
                      background: claveFeel === val ? T.ok : T.txt + "20",
                      color: claveFeel === val ? T.bg : T.txt,
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 9,
                      fontWeight: claveFeel === val ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {claveFeel === "44" && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 9, color: T.txt + "80", marginBottom: 4, display: "block" }}>Type</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["son", "rumba"].map(t => (
                    <button
                      key={t}
                      onClick={() => setClaveType(t)}
                      style={{
                        padding: "4px 8px",
                        background: claveType === t ? T.ok : T.txt + "20",
                        color: claveType === t ? T.bg : T.txt,
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 9,
                        fontWeight: claveType === t ? 600 : 400,
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {claveFeel === "44" && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 9, color: T.txt + "80", marginBottom: 4, display: "block" }}>Direction</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[{ val: "32", label: "3-2" }, { val: "23", label: "2-3" }].map(({ val, label }) => (
                    <button
                      key={val}
                      onClick={() => setClaveDir(val)}
                      style={{
                        padding: "4px 8px",
                        background: claveDir === val ? T.ok : T.txt + "20",
                        color: claveDir === val ? T.bg : T.txt,
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 9,
                        fontWeight: claveDir === val ? 600 : 400,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {claveFeel === "68" && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 9, color: T.txt + "80", marginBottom: 4, display: "block" }}>Pattern</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["clave68", "clave68alt"].map(p => (
                    <button
                      key={p}
                      onClick={() => setClave68Pat(p)}
                      style={{
                        padding: "4px 8px",
                        background: clave68Pat === p ? T.ok : T.txt + "20",
                        color: clave68Pat === p ? T.bg : T.txt,
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 9,
                        fontWeight: clave68Pat === p ? 600 : 400,
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setClavePulse(!clavePulse)}
                style={{
                  padding: "6px 12px",
                  background: clavePulse ? T.ok : T.txt + "20",
                  color: clavePulse ? T.bg : T.txt,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: clavePulse ? 600 : 400,
                }}
              >
                Clave Pulse
              </button>
            </div>

            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setClaveCountIn(!claveCountIn)}
                style={{
                  padding: "6px 12px",
                  background: claveCountIn ? T.ok : T.txt + "20",
                  color: claveCountIn ? T.bg : T.txt,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: claveCountIn ? 600 : 400,
                }}
              >
                Clave Count In
              </button>
            </div>
          </>
        )}
      </div>

    </PanelWrap>
  );

  const renderMixer = () => (
    <PanelWrap id="mixer" title="Mixer" {...pp}>
      <div>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Master {Math.round(volMaster * 100)}%</label>
        <HSlider value={volMaster} min={0} max={1} onChange={setVolMaster} T={T} />
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Drone {Math.round(volDrone * 100)}%</label>
        <HSlider value={volDrone} min={0} max={1} onChange={setVolDrone} T={T} />
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Click {Math.round(volMet * 100)}%</label>
        <HSlider value={volMet} min={0} max={1} onChange={setVolMet} T={T} />
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.txt}20` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: T.txt + "80" }}>Pink Noise</span>
            <button
              onClick={() => setNoiseOn(!noiseOn)}
              style={{
                padding: "3px 8px",
                background: noiseOn ? T.ok : T.txt + "20",
                color: noiseOn ? T.bg : T.txt,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 9,
                fontWeight: noiseOn ? 600 : 400,
              }}
            >
              {noiseOn ? "On" : "Off"}
            </button>
          </div>
          <ToneKnob
            value={noiseTone}
            onChange={v => { setNoiseTone(v); if (eng.current) eng.current.setNoiseTone(v); }}
            label="Tone"
            T={T}
          />
        </div>

        {noiseOn && (
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Level {Math.round(noiseLevel * 100)}%</label>
            <HSlider value={noiseLevel} min={0} max={0.4} onChange={v => { setNoiseLevel(v); if (eng.current) eng.current.setNoiseLevel(v); }} T={T} />
          </div>
        )}
      </div>
    </PanelWrap>
  );

  const renderFocusView = () => (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 20,
        overflow: "auto",
      }}
    >
      <FocusRing
        progress={focusTimer.progress}
        phase={focusTimer.phase}
        T={T}
        secsLeft={focusTimer.secsLeft}
        isPaused={focusTimer.isPaused}
        justStarted={justStarted}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {FOCUS_MODES.map(fm => (
          <button
            key={fm.id}
            onClick={() => focusTimer.selectMode(fm)}
            style={{
              padding: "7px 14px",
              background: focusTimer.mode?.id === fm.id ? T.ok : T.txt + "20",
              color: focusTimer.mode?.id === fm.id ? T.bg : T.txt,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: focusTimer.mode?.id === fm.id ? 700 : 400,
              lineHeight: 1.3,
            }}
          >
            {fm.label}
            {fm.id !== "custom" && (
              <div style={{ fontSize: 9, opacity: 0.65, marginTop: 1, fontWeight: 400 }}>
                {fm.work}/{fm.brk}
              </div>
            )}
          </button>
        ))}
      </div>

      {focusTimer.mode?.id === "custom" && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ minWidth: 140 }}>
            <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Work (min) — {customWork}</label>
            <HSlider value={customWork} min={1} max={90} onChange={setCustomWork} T={T} />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={{ fontSize: 10, color: T.txt + "80", marginBottom: 4, display: "block" }}>Break (min) — {customBreak}</label>
            <HSlider value={customBreak} min={1} max={30} onChange={setCustomBreak} T={T} />
          </div>
        </div>
      )}

      {/* ── Work session complete: confirm break ─────────────────────── */}
      {focusTimer.phase === "work_done" && (
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.accent, letterSpacing: "0.03em" }}>
            Session complete
          </div>
          <div style={{ fontSize: 12, color: T.txt + "80" }}>
            Cycle {focusTimer.cycle} · {focusTimer.mode.work} min
            {focusTimer.todayMins > 0 && ` · ${focusTimer.todayMins} min today`}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={() => focusTimer.startBreak()}
              style={{ padding: "12px 26px", background: T.ok, color: T.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
            >
              Take {focusTimer.mode.brk}m break
            </button>
            <button
              onClick={() => focusTimer.skipBreak()}
              style={{ padding: "12px 20px", background: T.txt + "18", color: T.txt, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              Skip break
            </button>
          </div>
          <button
            onClick={() => { focusTimer.reset(); setConfirmReset(false); }}
            style={{ fontSize: 10, color: T.dim, background: "transparent", border: "none", cursor: "pointer", marginTop: 4 }}
          >
            Reset
          </button>
        </div>
      )}

      {/* ── Break complete: confirm next session ──────────────────────── */}
      {focusTimer.phase === "break_done" && (
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.ok, letterSpacing: "0.03em" }}>
            Break's over
          </div>
          <div style={{ fontSize: 12, color: T.txt + "80" }}>
            Ready for session {focusTimer.cycle + 1}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={() => focusTimer.startNextSession()}
              style={{ padding: "12px 26px", background: T.accent, color: T.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
            >
              Start session
            </button>
            <button
              onClick={() => focusTimer.pause()}
              style={{ padding: "12px 20px", background: T.txt + "18", color: T.txt, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              Rest a bit more
            </button>
          </div>
        </div>
      )}

      {/* ── Normal controls (idle / work / break) ─────────────────────── */}
      {(focusTimer.phase === "idle" || focusTimer.phase === "work" || focusTimer.phase === "break") && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {focusTimer.phase === "idle" ? (
            focusTimer.isPaused ? (
              <button
                onClick={() => focusTimer.resume()}
                style={{ padding: "11px 22px", background: T.ok, color: T.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                Resume
              </button>
            ) : (
              <button
                onClick={() => {
                  if (focusTimer.mode?.id === "custom") focusTimer.setCustomTime(customWork, customBreak);
                  focusTimer.start();
                }}
                style={{ padding: "11px 22px", background: T.ok, color: T.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                Start
              </button>
            )
          ) : (
            <button
              onClick={() => focusTimer.pause()}
              style={{ padding: "11px 22px", background: T.warn, color: T.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
            >
              Stop
            </button>
          )}

          {focusTimer.phase === "break" && (
            <button
              onClick={() => focusTimer.skipBreak()}
              style={{ padding: "11px 22px", background: T.txt + "20", color: T.txt, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              Skip Break
            </button>
          )}

          {confirmReset ? (
            <>
              <button
                onClick={() => { focusTimer.reset(); setConfirmReset(false); }}
                style={{ padding: "11px 22px", background: T.err, color: T.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                style={{ padding: "11px 22px", background: T.txt + "20", color: T.txt, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              style={{ padding: "11px 22px", background: T.txt + "20", color: T.txt, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              Reset
            </button>
          )}
        </div>
      )}

      {focusTimer.phase === "break" && (
        <div style={{ textAlign: "center", color: T.ok, fontSize: 14, fontWeight: 600 }}>
          Take a break
        </div>
      )}

      {focusTimer.todayMins > 0 && (
        <div style={{ fontSize: 11, color: T.txt + "60" }}>
          Today: {focusTimer.todayMins} min focused
        </div>
      )}

      {showHelp && (
        <div
          style={{
            maxWidth: 360,
            padding: 16,
            background: T.bg2,
            border: `1px solid ${T.txt}20`,
            borderRadius: 8,
            fontSize: 12,
            color: T.txt,
            lineHeight: 1.7,
          }}
        >
          Focus Mode manages work/break intervals. Audio pauses during breaks and resumes automatically.
          <br /><br />
          Micro 15/3 · Standard 25/5 · Deep 50/10 · Extended 90/20 · Custom
        </div>
      )}

      <button
        onClick={() => setShowHelp(!showHelp)}
        style={{
          padding: "5px 12px",
          background: T.txt + "20",
          color: T.txt + "a0",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        {showHelp ? "Hide Help" : "?"}
      </button>
    </div>
  );

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  // Shared props for all PanelWrap instances (stable reference to panelRefs, changes only when layout/theme/drag state changes)
  const pp = { panelRefs, T, overId, dragId, onDown: onHandleDown };

  const panelContent = {
    fretboard: renderFretboard(),
    drone: renderDrone(),
    metro: renderMetro(),
    mixer: renderMixer(),
  };

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
    <div
      data-theme={theme}
      style={{
        width: APP_W,
        height: appH,
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        color: T.txt,
        fontFamily: "system-ui, sans-serif",
        overflow: "hidden",
        transform: `scale(${appScale})`,
        transformOrigin: "top left",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    >
      {/* PWA Update Prompt */}
      {updateAvailable && (
        <div
          className="lbe-theme flex items-center justify-center gap-3 px-4 py-2"
          style={{
            background: T.ok + "15",
            borderBottom: `1px solid ${T.ok}30`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "8px 16px",
          }}
        >
          <span style={{ fontSize: 10, color: T.ok }}>A new version is available</span>
          <button
            onClick={() => window.location.reload()}
            className="lbe-btn"
            style={{
              padding: "6px 12px",
              borderRadius: 20,
              fontSize: 9,
              fontWeight: "bold",
              background: T.ok + "20",
              border: `1px solid ${T.ok}50`,
              color: T.ok,
              cursor: "pointer",
            }}
          >
            Update
          </button>
        </div>
      )}

      {/* Panel Drag Overlay */}
      {dragId && (
        <div
          ref={dragOverlayRef}
          style={{
            position: "fixed",
            top: 0, left: 0, width: "100%", height: "100%",
            background: "transparent",
            cursor: "grabbing",
            zIndex: 1000,
          }}
          onPointerMove={(e) => {
            Object.entries(panelRefs.current).forEach(([id, el]) => {
              if (!el || id === dragId) return;
              const rect = el.getBoundingClientRect();
              if (e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom) {
                setOverId(id);
                overIdRef.current = id;
              }
            });
          }}
          onPointerUp={() => {
            const over = overIdRef.current;
            if (over && dragId && over !== dragId) {
              setPanelOrder(prev => {
                const arr = [...prev];
                const fi = arr.indexOf(dragId);
                const ti = arr.indexOf(over);
                if (fi !== -1 && ti !== -1) [arr[fi], arr[ti]] = [arr[ti], arr[fi]];
                return arr;
              });
            }
            setDragId(null);
            setOverId(null);
            overIdRef.current = null;
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: T.bg2,
          borderBottom: `1px solid ${T.txt}20`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Bass Lab</span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={switchTheme}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: T.txt + "20",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              color: T.txt,
              opacity: sunline ? 0.5 : 1,
              transition: "opacity 200ms",
            }}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </div>

      {/* Global Pause Overlay */}
      {globalPause && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: T.bg + "cc",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 500,
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 600, color: T.ok }}>PAUSED</div>
          <div style={{ fontSize: 13, color: T.txt + "80", letterSpacing: 1 }}>
            {String(Math.floor(pauseElapsed / 60)).padStart(2, "0")}:{String(pauseElapsed % 60).padStart(2, "0")}
          </div>
          <button
            onClick={resumePractice}
            style={{
              padding: "12px 24px",
              background: T.ok,
              color: T.bg,
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Resume
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "8px 16px",
          background: T.bg2,
          borderBottom: `1px solid ${T.txt}20`,
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setView("lab")}
          style={{
            padding: "6px 14px",
            background: view === "lab" ? T.accent + "22" : "transparent",
            color: view === "lab" ? T.accent : T.muted,
            border: `1px solid ${view === "lab" ? T.accent + "60" : T.line}`,
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            boxShadow: view === "lab" ? `0 0 10px ${T.accent}28` : "none",
          }}
        >
          Lab
        </button>

        <button
          onClick={() => setView("focus")}
          style={{
            padding: "6px 14px",
            background: view === "focus" ? T.accent + "22" : "transparent",
            color: view === "focus" ? T.accent : T.muted,
            border: `1px solid ${view === "focus" ? T.accent + "60" : T.line}`,
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            boxShadow: view === "focus" ? `0 0 10px ${T.accent}28` : "none",
          }}
        >
          Focus
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={pauseAll}
          style={{
            padding: "6px 12px",
            background: T.warn + "ff",
            color: T.bg,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Pause
        </button>

        <button
          onClick={allOff}
          disabled={!droneOn && !metOn && !noiseOn && !focusTimer.running}
          style={{
            padding: "6px 12px",
            background: T.err + (droneOn || metOn || noiseOn || focusTimer.running ? "ff" : "40"),
            color: T.bg,
            border: "none",
            borderRadius: 4,
            cursor: droneOn || metOn || noiseOn || focusTimer.running ? "pointer" : "not-allowed",
            fontSize: 11,
            fontWeight: 600,
            opacity: droneOn || metOn || noiseOn || focusTimer.running ? 1 : 0.5,
          }}
        >
          All Off
        </button>
      </div>

      {/* Break Banner */}
      {focusTimer.inBreak && (
        <div
          style={{
            padding: "12px 16px",
            background: T.ok + "20",
            border: `1px solid ${T.ok}40`,
            color: T.ok,
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          Break Time — Audio paused until work resumes
        </div>
      )}

      {/* Main Content */}
      {view === "focus" ? (
        renderFocusView()
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            gap: 12,
            padding: 12,
            overflow: "hidden",
            flexWrap: "nowrap",
            minHeight: 0,
          }}
        >
          {panelOrder.map(id => (
            <div
              key={id}
              style={{
                flex: 1,
                display: "flex",
                minHeight: 0,
                minWidth: 0,
              }}
            >
              {panelContent[id]}
            </div>
          ))}
        </div>
      )}

      {/* Status Strip */}
      {view === "lab" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 16px",
            background: T.bg2,
            borderTop: `1px solid ${T.txt}20`,
            fontSize: 10,
            color: T.txt + "80",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {metOn && (
              <>
                <div
                  key={`${beatDisplay.bar}-${beatDisplay.beat}`}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: T.warn,
                    flexShrink: 0,
                    animation: "beatPulse 220ms ease-out forwards",
                  }}
                />
                <span>Bar {beatDisplay.bar} · Beat {beatDisplay.beat + 1}</span>
                {beatDisplay.status && <span> · {beatDisplay.status}</span>}
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {droneOn && <span style={{ color: T.ok, fontSize: 8 }}>● drone</span>}
            {metOn && <span style={{ color: T.warn, fontSize: 8 }}>● click</span>}
            {noiseOn && <span style={{ color: T.txt + "80", fontSize: 8 }}>● noise</span>}
          </div>
        </div>
      )}

    </div>
    </div>
  );
}
