import { useEffect, useRef, useState } from "react";

type Feed = { t: string; agent: string; msg: string; tone: "sys" | "agent" | "warn" | "ok" };
type Props = {
  feed: Feed[];
  depth: Record<string, number>;
  zones: { id: string; name: string }[];
  live: boolean;
  mode: string;
};

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

function Panel({ title, count, children, className = "" }: { title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-sm border bg-card/60 ${className}`}>
      <header className="flex items-center justify-between border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em]">
        <span>{title}</span>
        {count !== undefined && <span className="rounded-sm bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{count}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-xs">{children}</div>
    </section>
  );
}

const AGENTS = [
  { id: "PERCEPTION", color: "text-accent" },
  { id: "FORECAST", color: "text-primary" },
  { id: "MOBILITY", color: "text-success" },
  { id: "SAFETY", color: "text-destructive" },
  { id: "COMMS", color: "text-accent" },
] as const;

const CONVO: [string, string, string][] = [
  ["PERCEPTION", "FORECAST", "Rain gauge at Silk Board reads 42 mm/h. Can you project depth?"],
  ["FORECAST", "PERCEPTION", "Model says 0.7 m in 25 min. Send me drain-level sensors too."],
  ["PERCEPTION", "FORECAST", "Drain DS-14 at 92% capacity. Uploading stream."],
  ["FORECAST", "MOBILITY", "Flag ORR eastbound and Hosur Rd underpass as high risk."],
  ["MOBILITY", "FORECAST", "Ack. Proposing diversion via Agara flyover — 6 min added."],
  ["MOBILITY", "SAFETY", "Ambulance corridor needed on 80 Ft Rd Koramangala?"],
  ["SAFETY", "MOBILITY", "Yes. Staging 2 units at St. John's, 1 at Narayana HSR."],
  ["SAFETY", "COMMS", "Draft shelter advisory for HSR Sector 2 residents."],
  ["COMMS", "SAFETY", "Draft ready in EN / KN / HI. 42k recipients. Approve?"],
  ["COMMS", "MOBILITY", "Include diversion map link in the SMS?"],
  ["MOBILITY", "COMMS", "Yes — short link generated: nmos.in/d/314"],
  ["PERCEPTION", "SAFETY", "CCTV shows stalled bus at Silk Board, ~30 passengers."],
  ["SAFETY", "PERCEPTION", "Dispatching rescue boat from Madiwala PS. ETA 9 min."],
];

type Msg = { t: string; from: string; to: string; text: string };
type Log = { t: string; level: "INFO" | "WARN" | "OK"; text: string };

export function CommandPanels({ feed, depth, zones, live, mode }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      const [from, to, text] = CONVO[i % CONVO.length]!;
      const ts = now();
      setMsgs((m) => [...m, { t: ts, from, to, text }].slice(-60));
      const lat = 40 + Math.round(Math.random() * 120);
      const log: Log =
        i % 4 === 3
          ? { t: ts, level: "WARN", text: `${from} → ${to}: confidence 0.71 below threshold, requesting second opinion` }
          : i % 5 === 4
          ? { t: ts, level: "OK", text: `Consensus reached between ${from} & ${to}. Action logged.` }
          : { t: ts, level: "INFO", text: `${from} → ${to} · ${lat} ms · ${text.length * 3} tokens · policy OK` };
      setLogs((l) => [log, ...l].slice(0, 80));
      setI((n) => n + 1);
    }, live ? 1200 : 2200);
    return () => clearTimeout(t);
  }, [i, paused, live]);

  useEffect(() => {
    chatEnd.current?.parentElement?.scrollTo({ top: 1e6, behavior: "smooth" });
  }, [msgs]);

  const alerts = feed.filter((f) => f.tone === "warn");
  const watched = [...zones].sort((a, b) => (depth[b.id] ?? 0) - (depth[a.id] ?? 0));
  const color = (id: string) => AGENTS.find((a) => a.id === id)?.color ?? "text-foreground";
  const warns = logs.filter((l) => l.level === "WARN").length;

  return (
    <div className="space-y-3 p-3">
      <div className="grid h-[520px] grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="WATCHLIST & PLAYBOOKS" count={3}>
          {["Monsoon-3 · Flood evacuation", "Vapor-1 · Gas leak isolation", "Gridlock-2 · Traffic surge"].map((p) => (
            <div key={p} className="mb-2 rounded-sm border border-dashed p-3">
              <div className="font-bold">{p.split(" · ")[0]}</div>
              <div className="mt-1 text-muted-foreground">{p.split(" · ")[1]}</div>
            </div>
          ))}
        </Panel>
        <Panel title="ALERT CENTER" count={alerts.length}>
          {alerts.length === 0 ? <p>No alerts in the past 30 minutes.</p> : alerts.map((a, k) => (
            <div key={k} className="mb-2 border-l-2 border-destructive pl-2">
              <div className="text-destructive">{a.agent} · {a.t}</div>
              <div className="text-muted-foreground">{a.msg}</div>
            </div>
          ))}
        </Panel>
        <Panel title="LIVE NEWS" className="xl:col-span-1">
          <div className="mb-3 flex flex-wrap gap-1">
            {["TV9 KANNADA", "PUBLIC TV", "NDTV", "THE HINDU", "DECCAN HERALD"].map((c, k) => (
              <span key={c} className={`rounded-sm border px-2 py-1 text-[10px] ${k === 0 ? "border-destructive bg-destructive text-destructive-foreground" : ""}`}>{c}</span>
            ))}
          </div>
          {(live ? [
            mode === "gas" ? "Gas leak reported near HSR Sector 2, area cordoned" : "Heavy rain lashes south Bengaluru, Silk Board flooded",
            "BBMP control room activated, citizens told to avoid ORR",
            "BMTC diverts buses; relief camps opened",
          ] : ["City calm. No major incidents reported.", "IMD: light showers expected this evening"]).map((n) => (
            <div key={n} className="mb-2 border-b pb-2">● {n}</div>
          ))}
        </Panel>
        <Panel title="SAVED PLACES" count={2}>
          {["BBMP HQ · Hudson Circle", "Control Room · Koramangala"].map((p) => (
            <div key={p} className="mb-2 rounded-sm border p-3">{p}</div>
          ))}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="LIVE WEBCAMS" className="h-64 xl:col-span-2">
          <div className="grid grid-cols-3 gap-2">
            {["Silk Board", "HSR 27th Main", "Bellandur ORR", "Koramangala 80ft", "BTM 2nd Stage", "Sarjapur Jn"].map((c) => (
              <div key={c} className="relative flex h-20 items-end rounded-sm border bg-background p-1 text-[10px]">
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive pulse-ring" />{c}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="WATCHED LOCATIONS" count={watched.length} className="h-64">
          {watched.map((z) => (
            <div key={z.id} className="flex justify-between border-b py-1.5"><span>{z.name}</span><span className="text-primary">{(depth[z.id] ?? 0).toFixed(2)}</span></div>
          ))}
        </Panel>
        <Panel title="LOCAL LOGISTICS" className="h-64">
          {[["Ambulances", "14 / 20"], ["Police units", "22 / 30"], ["BMTC buses", "8 reserved"], ["Rescue boats", "3 / 4"], ["Shelter beds", "1,240 free"]].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b py-1.5"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>
          ))}
        </Panel>
      </div>

      {/* AI agents communication */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <section className="flex h-[560px] flex-col rounded-sm border bg-card/60 xl:col-span-2">
          <header className="flex items-center justify-between border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em]">
            <span>● AGENT COMMS — 5 AGENTS</span>
            <div className="flex items-center gap-3">
              <div className="hidden gap-2 md:flex">
                {AGENTS.map((a) => <span key={a.id} className={`text-[10px] ${a.color}`}>● {a.id}</span>)}
              </div>
              <button onClick={() => setPaused((p) => !p)} className="rounded-sm border px-2 py-1 text-[10px]">{paused ? "▶ RESUME" : "❚❚ PAUSE"}</button>
            </div>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 font-mono text-xs">
            {msgs.map((m, k) => {
              const right = AGENTS.findIndex((a) => a.id === m.from) % 2 === 1;
              return (
                <div key={k} className={`flex ${right ? "justify-end" : ""}`}>
                  <div className="max-w-[75%] rounded-sm border bg-background/70 p-3">
                    <div className="mb-1 flex gap-2 text-[10px]">
                      <span className={color(m.from)}>{m.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className={color(m.to)}>{m.to}</span>
                      <span className="ml-auto text-muted-foreground">{m.t}</span>
                    </div>
                    <div>{m.text}</div>
                  </div>
                </div>
              );
            })}
            {!paused && <div className="text-muted-foreground">… agents are thinking</div>}
            <div ref={chatEnd} />
          </div>
        </section>

        <section className="flex h-[560px] flex-col rounded-sm border border-accent/50 bg-card/60">
          <header className="border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em] text-accent">◉ MONITOR AI — SUPERVISOR</header>
          <div className="grid grid-cols-3 gap-2 border-b p-3 font-mono text-[10px]">
            <div className="rounded-sm border p-2"><div className="text-muted-foreground">MESSAGES</div><div className="text-lg font-bold">{msgs.length}</div></div>
            <div className="rounded-sm border p-2"><div className="text-muted-foreground">FLAGS</div><div className="text-lg font-bold text-primary">{warns}</div></div>
            <div className="rounded-sm border p-2"><div className="text-muted-foreground">HEALTH</div><div className="text-lg font-bold text-success">{Math.max(80, 100 - warns)}%</div></div>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-3 font-mono text-[11px]">
            {logs.map((l, k) => (
              <div key={k} className="border-b pb-1">
                <span className="text-muted-foreground">{l.t}</span>{" "}
                <span className={l.level === "WARN" ? "text-primary" : l.level === "OK" ? "text-success" : "text-accent"}>[{l.level}]</span>{" "}
                {l.text}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
