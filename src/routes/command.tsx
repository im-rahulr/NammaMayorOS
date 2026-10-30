import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { CommandPanels } from "@/components/CommandPanels";

export const Route = createFileRoute("/command")({
  head: () => ({
    meta: [
      { title: "NammaMayor OS — Live command center" },
      { name: "description", content: "Live crisis map of Bangalore with AI agent feed, flood and gas-leak simulations, zone severity and dispatches." },
      { property: "og:title", content: "NammaMayor OS — Live command center" },
      { property: "og:description", content: "Live crisis map with AI agent feed, simulations, zone severity and dispatches." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Command,
});

type Kind = "hospital" | "police" | "shelter";
type Zone = { id: string; name: string; lat: number; lng: number; sens: number };
type Res = { id: string; kind: Kind; name: string; lat: number; lng: number };
type Feed = { t: string; agent: string; msg: string; tone: "sys" | "agent" | "warn" | "ok" };
type Dispatch = { id: string; res: Res; zone: Zone; status: "EN ROUTE" | "ON SCENE"; eta: number };
type Mode = "idle" | "storm" | "gas";

const ZONES: Zone[] = [
  { id: "SILKBOARD", name: "Silk Board Junction", lat: 12.9177, lng: 77.6238, sens: 1.5 },
  { id: "KORAMANGALA", name: "Koramangala", lat: 12.9352, lng: 77.6245, sens: 1.1 },
  { id: "SARJAPUR", name: "Sarjapur Road", lat: 12.9105, lng: 77.673, sens: 0.95 },
  { id: "BELLANDUR", name: "Bellandur", lat: 12.926, lng: 77.6762, sens: 0.85 },
  { id: "HSR", name: "HSR Layout", lat: 12.9116, lng: 77.6474, sens: 0.8 },
  { id: "BTM", name: "BTM Layout", lat: 12.9166, lng: 77.6101, sens: 0.6 },
];

const RES: Res[] = [
  { id: "H1", kind: "hospital", name: "St. John's Hospital", lat: 12.9298, lng: 77.6195 },
  { id: "H2", kind: "hospital", name: "Koramangala Clinic", lat: 12.9381, lng: 77.6301 },
  { id: "H3", kind: "hospital", name: "Sakra Hospital", lat: 12.9277, lng: 77.6814 },
  { id: "H4", kind: "hospital", name: "Narayana HSR", lat: 12.9081, lng: 77.6399 },
  { id: "H5", kind: "hospital", name: "BTM Care", lat: 12.9122, lng: 77.6062 },
  { id: "P1", kind: "police", name: "Koramangala PS", lat: 12.9448, lng: 77.6224 },
  { id: "P2", kind: "police", name: "Madiwala PS", lat: 12.9225, lng: 77.6155 },
  { id: "P3", kind: "police", name: "HSR PS", lat: 12.9142, lng: 77.6529 },
  { id: "P4", kind: "police", name: "Bellandur PS", lat: 12.9235, lng: 77.6792 },
  { id: "S1", kind: "shelter", name: "Agara Relief Camp", lat: 12.9235, lng: 77.6431 },
  { id: "S2", kind: "shelter", name: "HSR Community Hall", lat: 12.9072, lng: 77.6455 },
  { id: "S3", kind: "shelter", name: "Ibblur School", lat: 12.9205, lng: 77.6612 },
];

const GLYPH: Record<Kind, string> = { hospital: "+", police: "⛨", shelter: "⌂" };
const KIND_CLASS: Record<Kind, string> = { hospital: "bg-destructive", police: "bg-accent", shelter: "bg-success" };

const SCRIPT: Record<Exclude<Mode, "idle">, Record<number, [string, string, Feed["tone"]]>> = {
  storm: {
    1: ["PERCEPTION", "Rainfall 48 mm/h detected over Silk Board catchment", "agent"],
    4: ["FORECAST", "Flood depth at Silk Board projected 0.9 m within 20 min", "warn"],
    7: ["MOBILITY", "ORR eastbound closed; diverting via Hosur Rd flyover", "agent"],
    10: ["TRANSIT", "8 BMTC buses re-routed to Agara Relief Camp", "agent"],
    13: ["SAFETY", "Ambulances staged at St. John's & Narayana HSR", "agent"],
    16: ["COMMS", "SMS alert sent EN / KN / HI — 42,300 recipients", "agent"],
    19: ["ORCHESTRATOR", "AUTHORIZED: Plan Monsoon-3. Execute evacuation.", "ok"],
    30: ["SYS", "Water receding. Zones stabilising.", "ok"],
  },
  gas: {
    1: ["PERCEPTION", "Methane sensor spike near HSR Sector 2 — 4.1% LEL", "warn"],
    4: ["FORECAST", "Plume drifting NE at 3 m/s toward Agara", "warn"],
    7: ["MOBILITY", "500 m cordon set; 27th Main closed", "agent"],
    10: ["SAFETY", "Fire tender + 2 ambulances dispatched", "agent"],
    13: ["COMMS", "Shelter-in-place broadcast to HSR & Agara", "agent"],
    16: ["ORCHESTRATOR", "AUTHORIZED: Plan Vapor-1. Isolate GAIL valve 14.", "ok"],
    26: ["SYS", "Leak isolated. LEL back below 0.5%.", "ok"],
  },
};

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function Command() {
  const mapEl = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const circles = useRef<Record<string, Leaflet.Circle>>({});
  const lines = useRef<Leaflet.LayerGroup | null>(null);
  const hazard = useRef<Leaflet.Circle | null>(null);

  const [clock, setClock] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [tick, setTick] = useState(0);
  const [depth, setDepth] = useState<Record<string, number>>(() => Object.fromEntries(ZONES.map((z) => [z.id, 0.05 * z.sens])));
  const [feed, setFeed] = useState<Feed[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [tab, setTab] = useState<"Overview" | "Reports" | "Resources" | "Triage">("Overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [compute, setCompute] = useState<number | null>(null);
  const [showKinds, setShowKinds] = useState<Record<Kind, boolean>>({ hospital: true, police: true, shelter: true });
  const markers = useRef<Record<string, Leaflet.Marker>>({});

  const push = (agent: string, msg: string, tone: Feed["tone"]) => setFeed((f) => [{ t: now(), agent, msg, tone }, ...f].slice(0, 40));

  // clock + boot
  useEffect(() => {
    setClock(now());
    const i = setInterval(() => setClock(now()), 1000);
    push("SYS", "NammaMayorOS v2.0 — Crisis Intelligence Platform", "sys");
    push("SYS", "Bangalore — city operations area loaded", "sys");
    push("SYS", `${RES.length} resources · ${ZONES.length} zones online`, "sys");
    return () => clearInterval(i);
  }, []);

  // map init (browser only)
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !mapEl.current || map.current) return;
      const lf = (mod.default ?? mod) as typeof Leaflet;
      L.current = lf;
      // Lock the view to Bangalore only: user cannot pan or zoom outside the city
      const BOUND = lf.latLngBounds(lf.latLng(12.78, 77.42), lf.latLng(13.12, 77.84));
      const m = lf.map(mapEl.current, {
        zoomControl: false, attributionControl: true,
        maxBounds: BOUND, maxBoundsViscosity: 1.0, minZoom: 11, maxZoom: 19,
      }).setView([12.922, 77.645], 14);
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap", maxZoom: 19, className: "dark-tiles",
      }).addTo(m);
      lf.control.zoom({ position: "bottomright" }).addTo(m);
      ZONES.forEach((z) => {
        circles.current[z.id] = lf.circle([z.lat, z.lng], { radius: 150, weight: 1, fillOpacity: 0.25 })
          .addTo(m).bindTooltip(z.name).on("click", () => setSelected(z.id));
      });
      RES.forEach((r) => {
        const icon = lf.divIcon({
          className: "",
          html: `<div class="${KIND_CLASS[r.kind]} flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground text-base font-bold text-background shadow-lg">${GLYPH[r.kind]}</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16],
        });
        markers.current[r.id] = lf.marker([r.lat, r.lng], { icon }).addTo(m).bindPopup(`<b>${r.name}</b><br/>${r.kind}`);
      });
      lines.current = lf.layerGroup().addTo(m);
      map.current = m;
      paint(depth);
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paint = (d: Record<string, number>) => {
    const red = cssVar("--destructive"), amber = cssVar("--primary"), teal = cssVar("--accent");
    ZONES.forEach((z) => {
      const c = circles.current[z.id];
      if (!c) return;
      const v = d[z.id] ?? 0;
      const col = v > 0.6 ? red : v > 0.3 ? amber : teal;
      c.setRadius(120 + Math.min(v, 1.2) * 450);
      c.setStyle({ color: col, fillColor: col, fillOpacity: 0.15 + Math.min(v, 1) * 0.3 });
    });
  };
  useEffect(() => paint(depth), [depth]);

  useEffect(() => {
    Object.entries(markers.current).forEach(([id, mk]) => {
      const r = RES.find((x) => x.id === id)!;
      const el = mk.getElement();
      if (el) el.style.display = showKinds[r.kind] ? "" : "none";
    });
  }, [showKinds]);

  useEffect(() => {
    const z = ZONES.find((x) => x.id === selected);
    if (z && map.current) map.current.flyTo([z.lat, z.lng], 15, { duration: 0.8 });
  }, [selected]);

  // dispatch lines
  useEffect(() => {
    const lf = L.current, g = lines.current;
    if (!lf || !g) return;
    g.clearLayers();
    const col = cssVar("--primary");
    dispatches.forEach((d) => {
      lf.polyline([[d.res.lat, d.res.lng], [d.zone.lat, d.zone.lng]], {
        color: col, weight: 3, dashArray: d.status === "EN ROUTE" ? "6 8" : undefined, opacity: 0.9,
      }).addTo(g);
    });
  }, [dispatches]);

  // simulation loop
  useEffect(() => {
    if (mode === "idle") return;
    const end = mode === "storm" ? 34 : 30;
    const t = setTimeout(() => {
      const n = tick + 1;
      const line = SCRIPT[mode][n];
      if (line) push(line[0], line[1], line[2]);
      const peak = mode === "storm" ? 20 : 16;
      setDepth((prev) => {
        const next: Record<string, number> = {};
        ZONES.forEach((z) => {
          const focus = mode === "gas" ? (z.id === "HSR" ? 1.6 : z.id === "SARJAPUR" || z.id === "BELLANDUR" ? 0.5 : 0.1) : z.sens;
          const delta = n <= peak ? 0.045 * focus : -0.05 * focus;
          next[z.id] = Math.max(0.03, +((prev[z.id] ?? 0) + delta).toFixed(3));
        });
        return next;
      });
      if (n === 8 || n === 11 || n === 14) {
        const kind: Kind = n === 8 ? "police" : n === 11 ? "shelter" : "hospital";
        setDepth((cur) => {
          const worst = [...ZONES].sort((a, b) => (cur[b.id] ?? 0) - (cur[a.id] ?? 0)).slice(0, 2);
          setDispatches((ds) => [
            ...ds,
            ...worst.map((z) => {
              const res = RES.filter((r) => r.kind === kind).sort((a, b) => dist(a, z) - dist(b, z))[0]!;
              return { id: `${res.id}-${z.id}-${n}`, res, zone: z, status: "EN ROUTE" as const, eta: 6 + Math.round(dist(res, z) * 400) };
            }),
          ]);
          return cur;
        });
      }
      setDispatches((ds) => ds.map((d) => (d.eta <= 1 ? { ...d, eta: 0, status: "ON SCENE" } : { ...d, eta: d.eta - 1 })));
      if (n >= end) {
        setMode("idle");
        push("SYS", "Simulation complete. All units reporting.", "ok");
      }
      setTick(n);
    }, 700);
    return () => clearTimeout(t);
  }, [mode, tick]);

  // gas hazard ring
  useEffect(() => {
    const lf = L.current, m = map.current;
    if (!lf || !m) return;
    if (mode === "gas" && !hazard.current) {
      const col = cssVar("--primary");
      hazard.current = lf.circle([12.9116, 77.6474], { radius: 500, color: col, weight: 2, dashArray: "4 6", fillOpacity: 0.08 }).addTo(m).bindTooltip("Gas leak cordon");
    }
    if (mode === "idle" && hazard.current) { hazard.current.remove(); hazard.current = null; }
  }, [mode]);

  const run = (m: Exclude<Mode, "idle">) => {
    const t0 = performance.now();
    setDispatches([]);
    setDepth(Object.fromEntries(ZONES.map((z) => [z.id, 0.05 * z.sens])));
    setTick(0);
    setMode(m);
    push("SYS", m === "storm" ? "Scenario: Monsoon cloudburst — 34 steps" : "Scenario: Gas leak, HSR Sector 2 — 30 steps", "warn");
    setCompute(Math.round(performance.now() - t0 + 40 + Math.random() * 30));
  };

  const sorted = useMemo(() => [...ZONES].sort((a, b) => (depth[b.id] ?? 0) - (depth[a.id] ?? 0)), [depth]);
  const avg = ZONES.reduce((s, z) => s + (depth[z.id] ?? 0), 0) / ZONES.length;
  const critical = ZONES.filter((z) => (depth[z.id] ?? 0) > 0.6).length;
  const affected = ZONES.filter((z) => (depth[z.id] ?? 0) > 0.3).length;
  const live = mode !== "idle";
  const risk = Math.min(99, Math.round(avg * 110));
  const evac = Math.min(100, dispatches.filter((d) => d.status === "ON SCENE").length * 17);
  const buses = mode === "storm" && tick >= 10 ? 8 : mode === "gas" && tick >= 10 ? 3 : dispatches.length ? 8 : 0;
  const unit = mode === "gas" ? "% LEL" : "m";

  return (
    <div className="min-h-screen bg-background text-foreground">
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 font-mono text-xs">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold tracking-[0.25em] text-accent">NAMMAMAYOR<span className="text-muted-foreground">OS</span></Link>
          <span className="hidden rounded-sm border border-accent/40 px-2 py-1 text-accent md:inline">Government · BBMP</span>
          <span className="hidden text-muted-foreground md:inline">Bangalore · {live ? (mode === "storm" ? "Monsoon event" : "Gas leak") : "Standby"}</span>
        </div>
        <div className="flex items-center gap-2 tracking-[0.2em]">
          <span className={`h-2 w-2 rounded-full ${live ? "bg-destructive pulse-ring" : "bg-success"}`} />
          {live ? <span className="text-destructive">LIVE · T+{tick}</span> : "STANDBY"}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{clock} IST</span>
          <button onClick={() => run("storm")} disabled={live} className="rounded-sm border border-accent px-4 py-2 font-semibold tracking-widest text-accent hover:bg-accent hover:text-accent-foreground disabled:opacity-40">▶ RUN DEMO</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-card/60 p-4">
          <div>
            <h3 className="font-mono text-[10px] tracking-[0.3em] text-accent">● AGENT FEED — LIVE</h3>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
              {feed.map((f, i) => (
                <div key={feed.length - i} className="animate-in fade-in rounded-sm border bg-background/60 p-2 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className={f.tone === "warn" ? "text-destructive" : f.tone === "ok" ? "text-success" : f.tone === "agent" ? "text-primary" : "text-accent"}>● {f.agent}</span>
                    <span className="text-muted-foreground">{f.t}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{f.msg}</div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => run("storm")} disabled={live} className="rounded-sm border border-accent bg-accent/10 py-3 font-mono text-sm font-bold tracking-[0.2em] text-accent hover:bg-accent/20 disabled:opacity-40">SIMULATE STORM</button>
          <button onClick={() => run("gas")} disabled={live} className="rounded-sm bg-primary py-3 font-mono text-sm font-bold tracking-widest text-primary-foreground hover:opacity-90 disabled:opacity-40">🔥 GAS LEAK MODE</button>
          {live && <button onClick={() => { setMode("idle"); push("SYS", "Simulation aborted by operator", "warn"); }} className="rounded-sm border border-destructive py-2 font-mono text-xs text-destructive">■ ABORT</button>}

          <div className="border-t pt-3">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">COMPUTE</div>
            <div className="text-2xl font-bold">{compute ? `${compute} ms` : "-- ms"}</div>
          </div>

          <div className="border-t pt-3">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">MAP LAYERS</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(showKinds) as Kind[]).map((k) => (
                <button key={k} onClick={() => setShowKinds((s) => ({ ...s, [k]: !s[k] }))}
                  className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] capitalize ${showKinds[k] ? "" : "opacity-40"}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${KIND_CLASS[k]}`} />{k}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t pt-3">
            <h3 className="font-mono text-sm font-bold tracking-widest text-accent">GOVERNMENT DASHBOARD</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[["Affected zones", affected], ["Critical zones", critical], ["Max level", `${Math.max(...Object.values(depth)).toFixed(2)}${unit}`], ["Units out", dispatches.length]].map(([l, v]) => (
                <div key={l as string} className="rounded-sm border bg-background/60 p-3">
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">{l}</div>
                  <div className="mt-1 text-xl font-bold">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* map */}
        <div className="relative min-w-0 flex-1">
          <div ref={mapEl} className="h-full w-full bg-background" />
          <div className="pointer-events-none absolute right-4 top-4 z-[500] w-48 space-y-px overflow-hidden rounded-sm border bg-card/90 font-mono text-[10px] tracking-widest">
            {[["CROWD RISK", live || risk > 10 ? `${risk}%` : "—"], ["EVACUATION", evac ? `${evac}%` : "—"], ["RESPONSE", dispatches.length ? `${Math.round(dispatches.reduce((s, d) => s + d.eta, 0) / dispatches.length)}m` : "—"], ["BUSES", buses]].map(([l, v]) => (
              <div key={l as string} className="flex items-center justify-between border-b px-3 py-2.5 last:border-0">
                <span className="text-muted-foreground">{l}</span><span className="text-base font-bold text-accent">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* right */}
        <aside className="hidden w-80 shrink-0 flex-col border-l bg-card/60 lg:flex">
          <div className="border-b p-4">
            <div className="font-semibold text-accent">🏛 Government · BBMP</div>
            <div className="text-xs text-muted-foreground">Control room · Full access</div>
          </div>
          <div className="flex border-b font-mono text-xs">
            {(["Overview", "Reports", "Resources", "Triage"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 ${tab === t ? "border-b-2 border-accent text-accent" : "text-muted-foreground"}`}>{t}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4 text-sm">
            {tab === "Overview" && (
              <>
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">SIMULATION METRICS</div>
                <div className="mt-2 flex items-center justify-between rounded-sm border bg-background/60 p-3">
                  <span className="text-xs text-muted-foreground">{mode === "gas" ? "Average gas level" : "Average flood depth"}</span>
                  <span className="text-lg font-bold">{avg.toFixed(2)}{unit}</span>
                </div>
                <div className="mt-5 font-mono text-[10px] tracking-widest text-muted-foreground">ZONE SEVERITY</div>
                {sorted.map((z) => {
                  const v = (depth[z.id] ?? 0);
                  return (
                    <button key={z.id} onClick={() => setSelected(z.id)} className={`flex w-full items-center gap-2 border-b py-2.5 text-left ${selected === z.id ? "bg-secondary" : ""}`}>
                      <span className="w-28 truncate">{z.name}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className={`block h-full transition-all ${v > 0.6 ? "bg-destructive" : v > 0.3 ? "bg-primary" : "bg-accent"}`} style={{ width: `${Math.min(100, v * 100)}%` }} />
                      </span>
                      <span className="w-14 text-right font-mono text-xs text-primary">{v.toFixed(2)}{unit}</span>
                    </button>
                  );
                })}
                <div className="mt-5 font-mono text-[10px] tracking-widest text-muted-foreground">DISPATCHES ({dispatches.length})</div>
                {dispatches.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No active dispatches</p> : dispatches.map((d) => (
                  <div key={d.id} className="mt-2 rounded-sm border bg-background/60 p-2 text-xs">
                    <div className="flex justify-between"><span>{d.res.name}</span><span className={d.status === "ON SCENE" ? "text-success" : "text-primary"}>{d.status}</span></div>
                    <div className="text-muted-foreground">→ {d.zone.name}{d.eta > 0 && ` · ETA ${d.eta}m`}</div>
                  </div>
                ))}
              </>
            )}
            {tab === "Reports" && (
              <div className="space-y-2">
                {feed.filter((f) => f.agent !== "SYS").length === 0 && <p className="text-xs text-muted-foreground">No agent reports yet. Run a simulation.</p>}
                {feed.filter((f) => f.agent !== "SYS").map((f, i) => (
                  <div key={i} className="rounded-sm border bg-background/60 p-2 text-xs"><span className="font-mono text-accent">{f.agent}</span> <span className="text-muted-foreground">{f.t}</span><div className="mt-1">{f.msg}</div></div>
                ))}
              </div>
            )}
            {tab === "Resources" && RES.map((r) => {
              const busy = dispatches.some((d) => d.res.id === r.id);
              return (
                <button key={r.id} onClick={() => map.current?.flyTo([r.lat, r.lng], 16)} className="flex w-full items-center gap-2 border-b py-2 text-left">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-background ${KIND_CLASS[r.kind]}`}>{GLYPH[r.kind]}</span>
                  <span className="flex-1">{r.name}</span>
                  <span className={`font-mono text-[10px] ${busy ? "text-primary" : "text-success"}`}>{busy ? "DEPLOYED" : "READY"}</span>
                </button>
              );
            })}
            {tab === "Triage" && sorted.map((z, i) => {
              const v = (depth[z.id] ?? 0);
              const p = v > 0.6 ? "P1 · CRITICAL" : v > 0.3 ? "P2 · HIGH" : "P3 · MONITOR";
              return (
                <div key={z.id} className="mb-2 rounded-sm border bg-background/60 p-3">
                  <div className="flex justify-between text-xs"><span className="font-semibold">#{i + 1} {z.name}</span><span className={v > 0.6 ? "text-destructive" : v > 0.3 ? "text-primary" : "text-muted-foreground"}>{p}</span></div>
                  <div className="mt-1 text-xs text-muted-foreground">Est. {Math.round(v * 4200).toLocaleString()} residents exposed</div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
    <CommandPanels feed={feed} depth={depth} zones={ZONES} live={live} mode={mode} />
    </div>
  );
}
