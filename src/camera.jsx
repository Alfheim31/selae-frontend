import { useState, useEffect, useRef } from "react";
import { Lock, Camera, CameraOff } from "lucide-react";

/* ---------------- gate scanner ---------------- */
export function useBeep(enabled) {
  const ctxRef = useRef(null);
  return (kind) => {
    if (!enabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = ctxRef.current || (ctxRef.current = new Ctx());
      const tones = kind === "ok" ? [[880, 0, 0.13]] : kind === "attention" ? [[560, 0, 0.12], [560, 0.18, 0.12]] : [[220, 0, 0.3]];
      tones.forEach(([f, start, dur]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime + start;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      });
    } catch (e) { /* audio unavailable */ }
  };
}

export function HoldToExit({ onExit }) {
  const [p, setP] = useState(0);
  const raf = useRef(0);
  const begin = () => {
    const start = performance.now();
    const step = (t) => {
      const v = Math.min(1, (t - start) / 1200);
      setP(v);
      if (v >= 1) { setP(0); onExit(); return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  const cancel = () => { cancelAnimationFrame(raf.current); setP(0); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <button className="btn btn-sm hold" onPointerDown={begin} onPointerUp={cancel} onPointerLeave={cancel}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={cancel} aria-label="Hold to exit gate mode">
      <span className="fill" style={{ width: `${p * 100}%` }} />
      <Lock size={15} /> <span style={{ position: "relative" }}>Hold to exit gate mode</span>
    </button>
  );
}


/* ---------------- live camera ---------------- */
/* Opens the webcam and shows the feed. It does not decode anything yet:
   identification still runs through the demo scenarios below. */
export function useCamera(enabled, deviceId) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("off"); // off | starting | live | denied | notfound | insecure | error
  const [detail, setDetail] = useState("");
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    if (!enabled) { stop(); setState("off"); return; }

    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // getUserMedia only exists on https or localhost
      setState("insecure");
      return;
    }

    setState("starting");
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch (e) { /* autoplay guard */ }
        }
        setState("live");
        setDetail("");
        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setDevices(list.filter((d) => d.kind === "videoinput"));
        } catch (e) { /* labels need permission; ignore */ }
      })
      .catch((err) => {
        if (cancelled) return;
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "SecurityError") setState("denied");
        else if (name === "NotFoundError" || name === "DevicesNotFoundError") setState("notfound");
        else if (name === "NotReadableError" || name === "TrackStartError") setState("error");
        else if (name === "OverconstrainedError") setState("notfound");
        else setState("error");
        setDetail((err && err.message) || String(err));
      });

    return () => { cancelled = true; stop(); };
  }, [enabled, deviceId]);

  const freeze = () => { if (videoRef.current) videoRef.current.pause(); };
  const resume = () => { if (videoRef.current && videoRef.current.paused) videoRef.current.play().catch(() => {}); };

  return { videoRef, state, detail, devices, freeze, resume };
}

export function CameraStage({ cam, phase, card, glare, onRetry, onUseIllustration }) {
  const { videoRef, state, detail } = cam;
  const live = state === "live";
  const showIllustration = !live && state === "off" && card !== undefined && false; // reserved

  if (state === "starting") {
    return (
      <div className="vf-center">
        <div className="spin" aria-hidden="true" />
        <div className="text-lg font-bold">Starting camera</div>
        <p>macOS will ask for permission the first time. Choose Allow.</p>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">Camera permission blocked</div>
        <ol>
          <li>1. Click the camera icon in the browser address bar and allow access for this site.</li>
          <li>2. If it still fails, open System Settings, Privacy &amp; Security, Camera, and switch your browser on.</li>
          <li>3. Reload the page, then start the camera again.</li>
        </ol>
        <div className="flex gap-2">
          <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
          <button className="btn btn-ghost" onClick={onUseIllustration}>Continue without camera</button>
        </div>
      </div>
    );
  }
  if (state === "notfound") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">No camera found</div>
        <p>Connect a webcam, or close any app already using it (Zoom, Photo Booth, Google Meet), then try again.</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
      </div>
    );
  }
  if (state === "insecure") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">Camera needs a secure page</div>
        <p>Browsers only hand over the camera on https or on localhost. Open the app at http://localhost:5173 rather than a network address.</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">Camera couldn't start</div>
        <p>{detail || "Another application may be holding the camera."}</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
      </div>
    );
  }
  if (state === "off") {
    return (
      <div className="vf-center">
        <CameraOff size={44} color="var(--warn)" />
        <div className="text-xl font-bold">Camera off</div>
        <p>Manual entry below still checks attendees in. Turn the camera back on when the hardware is ready.</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Start camera</button>
      </div>
    );
  }
  return null;
}

