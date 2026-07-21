import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  ArrowPathIcon,
  ChartBarIcon,
  SignalIcon,
  ClockIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import PageHeader from './PageHeader';
import { PM2Process, SystemMetricsData } from '../types/pm2';
import { REMOTE_CONNECTIONS_CHANGED_EVENT } from '../utils/server-selection';

// @group ChartJS : Register required chart.js components
ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

// @group Types : API response shapes
interface ConnectionInfo { id: string; name: string; }
interface HistMetricPoint {
  id: number;
  connection_id: string;
  connection_name: string;
  process_name: string;
  pm_id: number;
  timestamp: number;
  cpu: number;
  memory_bytes: number;
  memory_mb: number;
}
interface LivePoint { ts: number; cpu: number; memMb: number; }

// @group Constants
const MAX_LIVE_POINTS = 1200; // 1 hour at 3s
const TIME_RANGES: { label: string; ms: number }[] = [
  { label: '30 min', ms: 30 * 60_000 },
  { label: '1 hr',   ms: 60 * 60_000 },
  { label: '6 hr',   ms: 6  * 60 * 60_000 },
  { label: '12 hr',  ms: 12 * 60 * 60_000 },
  { label: '24 hr',  ms: 24 * 60 * 60_000 },
  { label: '7 days', ms: 7  * 24 * 60 * 60_000 },
];

// @group Utilities
function stats(values: number[]): { min: number; max: number; avg: number } {
  if (values.length === 0) return { min: 0, max: 0, avg: 0 };
  let min = values[0], max = values[0], sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / values.length };
}

function fmtTs(ts: number, rangeMs: number): string {
  const d = new Date(ts);
  if (rangeMs <= 60 * 60_000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (rangeMs <= 24 * 60 * 60_000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// @group Sparkline : Lightweight SVG micro-chart for inline use in tables
const Sparkline = ({
  values,
  color,
  width = 120,
  height = 30,
  max,
  fluid = false,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  max?: number;
  fluid?: boolean;
}) => {
  const W_vb = 200; // fixed viewBox coordinate space
  const H_vb = height;
  if (values.length < 2) {
    const style = fluid
      ? { display: 'block', width: '100%', height }
      : { display: 'inline-block', width, height, lineHeight: `${height}px` };
    return (
      <span style={style} className="text-center text-[#555] text-[11px]">
        —
      </span>
    );
  }
  const pad  = 2;
  const W    = W_vb - pad * 2;
  const H    = H_vb - pad * 2;
  const yMax = max ?? Math.max(...values, 0.01);
  const norm = (v: number) => pad + H - (v / yMax) * H;

  const pts = values
    .map((v, i) => `${pad + (i / (values.length - 1)) * W},${norm(v)}`)
    .join(' ');

  const fillPts = [
    `${pad},${norm(values[0])}`,
    ...values.slice(1).map((v, i) => `${pad + ((i + 1) / (values.length - 1)) * W},${norm(v)}`),
    `${pad + W},${pad + H}`,
    `${pad},${pad + H}`,
  ].join(' ');

  const svgProps = fluid
    ? { width: '100%', height, viewBox: `0 0 ${W_vb} ${H_vb}`, preserveAspectRatio: 'none' as const, style: { display: 'block' } }
    : { width, height, style: { display: 'inline-block', verticalAlign: 'middle' } };

  return (
    <svg {...svgProps}>
      <polygon points={fillPts} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

function fmtMem(bytes: number): string {
  if (bytes === 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

// @group MetricsPage : Props
interface MetricsPageProps {
  processes: PM2Process[];
  metrics: SystemMetricsData;
}

// @group MetricsPage : Main component
// @group Constants : Identifier used for the local machine wherever a server/connection id is expected
const LOCAL_CONN_ID = '__local__';

// @group Constants : How often the Live tab polls a selected remote server's process list (ms)
const REMOTE_LIVE_POLL_MS = 5000;

const MetricsPage: React.FC<MetricsPageProps> = ({ processes }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'live' | 'history'>('live');

  // @group LiveState
  const [selectedLiveProc, setSelectedLiveProc] = useState<string>('');
  const liveBufferRef = useRef<Map<string, LivePoint[]>>(new Map());
  const [, setLiveRender] = useState(0); // bump to force re-render on buffer update
  const [actionLoading, setActionLoading] = useState<{ [pmId: number]: boolean }>({});
  const seededRef = useRef<Set<string>>(new Set()); // buffer keys already pre-filled from recorded history

  // @group LiveServers : Server (local or a connected remote) the Live tab is currently showing
  const [liveServers, setLiveServers] = useState<{ id: string; name: string }[]>([
    { id: LOCAL_CONN_ID, name: t('metricsPage.localSource') },
  ]);
  const [selectedLiveServer, setSelectedLiveServer] = useState<string>(LOCAL_CONN_ID);
  const [remoteLiveProcesses, setRemoteLiveProcesses] = useState<PM2Process[]>([]);

  // @group LiveServers : Build a per-server key so buffers/history from different servers never collide
  const bufKey = useCallback((serverId: string, procName: string) => `${serverId}::${procName}`, []);

  // @group LiveServers : Load the list of servers available to inspect live (local + connected remotes)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get<any[]>('/api/remote/connections');
        if (cancelled) return;
        const connected = res.data.filter(c => c.connected).map(c => ({ id: c.id, name: c.name }));
        setLiveServers([{ id: LOCAL_CONN_ID, name: t('metricsPage.localSource') }, ...connected]);
      } catch {
        if (!cancelled) setLiveServers([{ id: LOCAL_CONN_ID, name: t('metricsPage.localSource') }]);
      }
    };
    load();
    const interval = setInterval(load, REMOTE_LIVE_POLL_MS);
    window.addEventListener(REMOTE_CONNECTIONS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(REMOTE_CONNECTIONS_CHANGED_EVENT, load);
    };
  }, [t]);

  // Fall back to Local if the selected remote server disconnects or is removed
  useEffect(() => {
    if (selectedLiveServer === LOCAL_CONN_ID) return;
    if (!liveServers.some(s => s.id === selectedLiveServer)) {
      setSelectedLiveServer(LOCAL_CONN_ID);
      setRemoteLiveProcesses([]);
    }
  }, [liveServers, selectedLiveServer]);

  // @group LiveServers : Poll the selected remote server's process list at near-live cadence
  useEffect(() => {
    if (tab !== 'live' || selectedLiveServer === LOCAL_CONN_ID) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await axios.get<PM2Process[]>(`/api/remote/${selectedLiveServer}/processes`);
        if (!cancelled) setRemoteLiveProcesses(res.data);
      } catch {
        if (!cancelled) setRemoteLiveProcesses([]);
      }
    };
    poll();
    const interval = setInterval(poll, REMOTE_LIVE_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tab, selectedLiveServer]);

  // @group LiveProcesses : Processes shown by the Live tab for the currently selected server
  const liveProcesses = selectedLiveServer === LOCAL_CONN_ID ? processes : remoteLiveProcesses;

  const handleProcessAction = useCallback(async (
    e: React.MouseEvent, proc: PM2Process, action: 'start' | 'stop' | 'restart' | 'delete'
  ) => {
    e.stopPropagation();
    setActionLoading(prev => ({ ...prev, [proc.pm_id]: true }));
    try {
      if (selectedLiveServer === LOCAL_CONN_ID) {
        await axios.post(`/api/process/${proc.pm_id}/${action}`);
      } else {
        await axios.post(`/api/remote/${selectedLiveServer}/processes/${proc.name}/${action}`);
      }
    } catch (err) {
      console.error(`Failed to ${action} process:`, err);
    } finally {
      setActionLoading(prev => ({ ...prev, [proc.pm_id]: false }));
    }
  }, [selectedLiveServer]);

  // @group HistoryState
  const [connections,       setConnections]       = useState<ConnectionInfo[]>([]);
  const [selectedConn,      setSelectedConn]      = useState<string>(LOCAL_CONN_ID);
  const [histProcs,         setHistProcs]         = useState<string[]>([]);
  const [selectedHistProc,  setSelectedHistProc]  = useState<string>('');
  const [rangeIdx,          setRangeIdx]          = useState<number>(1);
  const [histMetrics,       setHistMetrics]       = useState<HistMetricPoint[]>([]);
  const [histLoading,       setHistLoading]       = useState(false);
  const [autoRefresh,       setAutoRefresh]       = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // @group LiveBuffer : Accumulate live readings into a per-server, per-process rolling buffer
  useEffect(() => {
    const now = Date.now();
    const map = liveBufferRef.current;
    const liveKeys = new Set(liveProcesses.map(p => bufKey(selectedLiveServer, p.name)));

    for (const proc of liveProcesses) {
      const key = bufKey(selectedLiveServer, proc.name);
      const existing = map.get(key) ?? [];
      existing.push({
        ts:    now,
        cpu:   proc.monit.cpu,
        memMb: proc.monit.memory / (1024 * 1024),
      });
      if (existing.length > MAX_LIVE_POINTS) existing.shift();
      map.set(key, existing);
    }

    // Remove processes of the current server no longer in its list
    for (const key of map.keys()) {
      if (key.startsWith(`${selectedLiveServer}::`) && !liveKeys.has(key)) map.delete(key);
    }

    setLiveRender(n => n + 1);
  }, [liveProcesses, selectedLiveServer, bufKey]);

  // @group LiveBuffer : Pre-fill a freshly selected server/process's buffer from already-recorded
  // history so the chart draws a real line immediately instead of a lone point.
  useEffect(() => {
    let cancelled = false;

    const seedLocal = async () => {
      try {
        const res = await axios.get<{ pm_id: number; name: string; history: { timestamp: number; cpu: number; memoryMB: number }[] }[]>(
          '/api/metrics/history'
        );
        if (cancelled) return;
        const map = liveBufferRef.current;
        for (const entry of res.data) {
          const key = bufKey(LOCAL_CONN_ID, entry.name);
          if (seededRef.current.has(key) || (map.get(key)?.length ?? 0) > 1) continue;
          seededRef.current.add(key);
          const seeded = entry.history.map(h => ({ ts: h.timestamp, cpu: h.cpu, memMb: h.memoryMB }));
          const existing = map.get(key) ?? [];
          map.set(key, [...seeded, ...existing].slice(-MAX_LIVE_POINTS));
        }
        if (!cancelled) setLiveRender(n => n + 1);
      } catch { /* silent — live buffer just stays empty until it fills naturally */ }
    };

    const seedRemote = async () => {
      for (const proc of liveProcesses) {
        const key = bufKey(selectedLiveServer, proc.name);
        if (seededRef.current.has(key)) continue;
        seededRef.current.add(key);
        try {
          const now = Date.now();
          const res = await axios.get<{ success: boolean; metrics: HistMetricPoint[] }>(
            `/api/remote-metrics/${encodeURIComponent(selectedLiveServer)}/${encodeURIComponent(proc.name)}`,
            { params: { from: now - 5 * 60_000, to: now } }
          );
          if (cancelled || !res.data.success) continue;
          const map = liveBufferRef.current;
          if ((map.get(key)?.length ?? 0) > 1) continue;
          const seeded = res.data.metrics.map(m => ({ ts: m.timestamp, cpu: m.cpu, memMb: m.memory_mb }));
          const existing = map.get(key) ?? [];
          map.set(key, [...seeded, ...existing].slice(-MAX_LIVE_POINTS));
        } catch { /* silent */ }
      }
      if (!cancelled) setLiveRender(n => n + 1);
    };

    if (selectedLiveServer === LOCAL_CONN_ID) void seedLocal();
    else if (liveProcesses.length > 0) void seedRemote();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLiveServer, liveProcesses.map(p => p.name).join(',')]);

  // Auto-select first live process when the list loads or the selected server changes
  useEffect(() => {
    if (liveProcesses.length === 0) return;
    if (!liveProcesses.find(p => p.name === selectedLiveProc)) {
      setSelectedLiveProc(liveProcesses[0].name);
    }
  }, [liveProcesses, selectedLiveProc]);

  // @group HistoryData : Load connections that have data; always prepend Local
  const loadConnections = useCallback(async () => {
    try {
      const res = await axios.get<{ success: boolean; connections: ConnectionInfo[] }>(
        '/api/remote-metrics/connections'
      );
      if (res.data.success) {
        const remotes = res.data.connections.filter(c => c.id !== LOCAL_CONN_ID);
        setConnections([{ id: LOCAL_CONN_ID, name: t('metricsPage.localSource') }, ...remotes]);
      }
    } catch {
      setConnections([{ id: LOCAL_CONN_ID, name: t('metricsPage.localSource') }]);
    }
  }, [t]);

  // Load on mount so Local is always available; reload when switching to History to pick up new remotes
  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (tab === 'history') loadConnections();
  }, [tab, loadConnections]);

  // @group HistoryData : Load process names when connection changes
  useEffect(() => {
    if (!selectedConn) return;
    setHistProcs([]);
    setSelectedHistProc('');
    setHistMetrics([]);
    axios.get<{ success: boolean; processes: string[] }>(
      `/api/remote-metrics/${encodeURIComponent(selectedConn)}/processes`
    ).then(res => {
      if (res.data.success) {
        setHistProcs(res.data.processes);
        if (res.data.processes.length > 0) setSelectedHistProc(res.data.processes[0]);
      }
    }).catch(() => {});
  }, [selectedConn]);

  // @group HistoryData : Fetch time-series
  const fetchHistory = useCallback(async () => {
    if (!selectedConn || !selectedHistProc) return;
    setHistLoading(true);
    try {
      const rangeMs = TIME_RANGES[rangeIdx].ms;
      const now = Date.now();
      const res = await axios.get<{ success: boolean; metrics: HistMetricPoint[] }>(
        `/api/remote-metrics/${encodeURIComponent(selectedConn)}/${encodeURIComponent(selectedHistProc)}`,
        { params: { from: now - rangeMs, to: now } }
      );
      if (res.data.success) setHistMetrics(res.data.metrics);
    } catch { /* silent */ } finally {
      setHistLoading(false);
    }
  }, [selectedConn, selectedHistProc, rangeIdx]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // @group AutoRefresh
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(fetchHistory, 30_000);
    } else {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [autoRefresh, fetchHistory]);

  // @group ChartConfig : Shared chart options factory
  const chartOptions = (yLabel: string, yMax?: number) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 } as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        callbacks: {
          label: (ctx: any) => ` ${ctx.parsed.y.toFixed(2)} ${yLabel}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { font: { size: 10, family: 'monospace' }, maxTicksLimit: 8, maxRotation: 0, color: '#555' },
        grid: { color: '#1e1e1e' },
      },
      y: {
        min: 0,
        ...(yMax !== undefined ? { max: yMax } : {}),
        ticks: { font: { size: 10, family: 'monospace' }, color: '#555' },
        grid: { color: '#1e1e1e' },
        title: { display: true, text: yLabel, font: { size: 10, family: 'monospace' }, color: '#555' },
      },
    },
  });

  // @group LiveChartData : Build chart data from rolling buffer
  const livePoints  = liveBufferRef.current.get(bufKey(selectedLiveServer, selectedLiveProc)) ?? [];
  const liveLabels  = livePoints.map(p =>
    new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const liveCpuData = livePoints.map(p => p.cpu);
  const liveMemData = livePoints.map(p => p.memMb);
  const liveCpuStats = stats(liveCpuData);
  const liveMemStats = stats(liveMemData);

  const liveCpuChart = {
    labels: liveLabels,
    datasets: [{
      data: liveCpuData,
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34,197,94,0.08)',
      borderWidth: 1.5,
      pointRadius: livePoints.length > 60 ? 0 : 2,
      tension: 0.3,
      fill: true,
    }],
  };
  const liveMemChart = {
    labels: liveLabels,
    datasets: [{
      data: liveMemData,
      borderColor: '#22d3ee',
      backgroundColor: 'rgba(34,211,238,0.08)',
      borderWidth: 1.5,
      pointRadius: livePoints.length > 60 ? 0 : 2,
      tension: 0.3,
      fill: true,
    }],
  };

  // @group HistChartData : Build chart data from SQLite history
  const histRangeMs  = TIME_RANGES[rangeIdx].ms;
  const histLabels   = histMetrics.map(m => fmtTs(m.timestamp, histRangeMs));
  const histCpuData  = histMetrics.map(m => m.cpu);
  const histMemData  = histMetrics.map(m => m.memory_mb);
  const histCpuStats = stats(histCpuData);
  const histMemStats = stats(histMemData);

  const histCpuChart = {
    labels: histLabels,
    datasets: [{
      data: histCpuData,
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34,197,94,0.08)',
      borderWidth: 1.5,
      pointRadius: histMetrics.length > 60 ? 0 : 2,
      tension: 0.3,
      fill: true,
    }],
  };
  const histMemChart = {
    labels: histLabels,
    datasets: [{
      data: histMemData,
      borderColor: '#22d3ee',
      backgroundColor: 'rgba(34,211,238,0.08)',
      borderWidth: 1.5,
      pointRadius: histMetrics.length > 60 ? 0 : 2,
      tension: 0.3,
      fill: true,
    }],
  };

  // @group StatCard : Small stat display helper
  const StatCard = ({
    label, value, unit, color,
  }: { label: string; value: number; unit: string; color: string }) => (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-sm px-2.5 py-1.5 flex flex-col gap-0.5">
      <span className="text-[11px] text-[#555] uppercase tracking-[0.15em]">{label}</span>
      <span className={`text-[13px] font-bold ${color}`}>
        {value.toFixed(2)}
        <span className="text-[11px] font-normal text-[#555] ml-0.5">{unit}</span>
      </span>
    </div>
  );

  // @group TabButton
  const TabButton = ({ id, label, icon: Icon }: { id: 'live' | 'history'; label: string; icon: React.ElementType }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] border-b-2 transition-colors ${
        tab === id
          ? 'border-[#22c55e] text-[#e8e8e8]'
          : 'border-transparent text-[#555] hover:text-[#888]'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  // @group SelectStyles : CLI-styled select element class
  const selectCls = `text-[12px] px-2 py-1.5 rounded-sm border border-[#1e1e1e]
    bg-[#111] text-[#e8e8e8]
    focus:outline-none focus:ring-1 focus:ring-[#22c55e] disabled:opacity-40`;

  // @group LiveCurrentProcess : current live process being viewed
  const currentProc = liveProcesses.find(p => p.name === selectedLiveProc);

  // @group SplitPane : Draggable divider state for live tab (left % of total width, default 3:2 = 60%)
  const [splitPct, setSplitPct] = useState(60);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.min(75, Math.max(25, pct)));
  };

  const onDividerPointerUp = () => { isDragging.current = false; };

  return (
    <div>
      <PageHeader
        title={t('metricsPage.title')}
        subtitle={t('metricsPage.subtitle')}
        actions={
          tab === 'history' ? (
            <button
              onClick={fetchHistory}
              disabled={histLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px]
                bg-[#111] border border-[#1e1e1e] text-[#888] hover:text-[#e8e8e8] hover:border-[#333]
                disabled:opacity-40 transition-colors"
            >
              <ArrowPathIcon className={`h-4 w-4 ${histLoading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </button>
          ) : undefined
        }
      />

      {/* ── Tabs ── */}
      <div className="flex gap-0 bg-[#111] border border-[#1e1e1e] rounded-sm mb-4 w-fit">
        <TabButton id="live"    label={t('metricsPage.live')}    icon={SignalIcon} />
        <TabButton id="history" label={t('metricsPage.history')} icon={ClockIcon} />
      </div>

      {/* ════════════════════ LIVE TAB ════════════════════ */}
      {tab === 'live' && (
        <div className="space-y-3">
          {/* Server selector — pick the local machine or any connected remote server */}
          {liveServers.length > 1 && (
            <div className="flex flex-col gap-0.5 w-fit">
              <label className="text-[11px] text-[#555] uppercase tracking-[0.12em]">Server</label>
              <select
                value={selectedLiveServer}
                onChange={e => { setSelectedLiveServer(e.target.value); setSelectedLiveProc(''); }}
                className={selectCls}
              >
                {liveServers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {liveProcesses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ChartBarIcon className="h-11 w-11 text-[#333] mb-3" />
              <p className="text-[12px] text-[#555]">No processes found</p>
              <p className="text-[12px] text-[#444] mt-1">
                {selectedLiveServer === LOCAL_CONN_ID
                  ? 'Make sure PM2 is running and connected'
                  : 'This server reported no PM2 processes'}
              </p>
            </div>
          ) : (
          <div
            ref={splitContainerRef}
            className="flex min-h-0"
            onPointerMove={onDividerPointerMove}
            onPointerUp={onDividerPointerUp}
          >

            {/* ── Left: Process list ── */}
            <div
              className="shrink-0 border border-[#1e1e1e] bg-[#0d0d0d] border-r border-r-[#1e1e1e] overflow-hidden flex flex-col rounded-sm"
              style={{ width: `${splitPct}%` }}
            >
              <div className="px-3 py-2 border-b border-[#1e1e1e] shrink-0">
                <p className="text-[12px] text-[#555] uppercase tracking-[0.15em]">Processes</p>
              </div>
              <div className="overflow-y-auto flex-1">
                {liveProcesses.map(proc => {
                  const procBuf = liveBufferRef.current.get(bufKey(selectedLiveServer, proc.name)) ?? [];
                  const isSelected = proc.name === selectedLiveProc;
                  return (
                    <div
                      key={proc.pm_id}
                      onClick={() => setSelectedLiveProc(proc.name)}
                      className={`cursor-pointer px-3 py-2 flex flex-col gap-1.5 border-b border-[#1e1e1e] transition-colors ${
                        isSelected
                          ? 'bg-[#111] border-l-2 border-l-[#22c55e]'
                          : 'hover:bg-[#111]'
                      }`}
                    >
                      {/* Name + status dot + action buttons */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${
                          proc.pm2_env.status === 'online' ? 'bg-[#22c55e]' :
                          proc.pm2_env.status === 'errored' ? 'bg-[#ef4444]' : 'bg-[#444]'
                        }`} />
                        <span className="text-[13px] text-[#e8e8e8] truncate flex-1 min-w-0">
                          {proc.name}
                        </span>

                        {/* Action buttons — icon-only, no bg */}
                        <div className="shrink-0 flex items-center gap-0.5">
                          {actionLoading[proc.pm_id] ? (
                            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-[#555]" />
                          ) : proc.pm2_env.status === 'online' ? (
                            <>
                              <button
                                onClick={e => handleProcessAction(e, proc, 'restart')}
                                title="Restart"
                                className="h-6 w-6 flex items-center justify-center text-[#444] hover:text-[#f59e0b] transition-colors"
                              >
                                <ArrowPathIcon className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={e => handleProcessAction(e, proc, 'stop')}
                                title="Stop"
                                className="h-6 w-6 flex items-center justify-center text-[#444] hover:text-[#ef4444] transition-colors"
                              >
                                <StopIcon className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={e => handleProcessAction(e, proc, 'start')}
                              title="Start"
                              className="h-6 w-6 flex items-center justify-center text-[#444] hover:text-[#22c55e] transition-colors"
                            >
                              <PlayIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={e => handleProcessAction(e, proc, 'delete')}
                            title="Delete"
                            className="h-6 w-6 flex items-center justify-center text-[#444] hover:text-[#888] transition-colors"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* CPU + MEM sparklines in one row */}
                      <div className="flex items-center gap-2 pointer-events-none">
                        <span className="text-[11px] text-[#555] shrink-0">CPU</span>
                        <span className={`text-[11px] tabular-nums shrink-0 ${
                          proc.monit.cpu >= 80 ? 'text-[#ef4444]' :
                          proc.monit.cpu >= 50 ? 'text-[#f59e0b]' : 'text-[#22c55e]'
                        }`}>{proc.monit.cpu.toFixed(1)}%</span>
                        <div className="flex-1 min-w-0">
                          <Sparkline values={procBuf.map(p => p.cpu)} color={isSelected ? '#22c55e' : '#333'} max={100} height={20} fluid />
                        </div>
                        <span className="text-[11px] text-[#555] shrink-0">MEM</span>
                        <span className="text-[11px] tabular-nums shrink-0 text-[#22d3ee]">{fmtMem(proc.monit.memory)}</span>
                        <div className="flex-1 min-w-0">
                          <Sparkline values={procBuf.map(p => p.memMb)} color={isSelected ? '#22d3ee' : '#333'} height={20} fluid />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Drag divider ── */}
            <div
              onPointerDown={onDividerPointerDown}
              className="w-1 shrink-0 bg-[#1a1a1a] hover:bg-[#333] cursor-col-resize transition-colors select-none"
            />

            {/* ── Right: Charts ── */}
            <div className="flex flex-col gap-3 min-w-0 flex-1 bg-[#0a0a0a] pl-3">
              {/* Selected process status bar */}
              {currentProc && (
                <div className="flex items-center gap-3 text-[12px] px-1">
                  <span className="text-[#e8e8e8]">{currentProc.name}</span>
                  <span className={`px-1.5 py-0.5 rounded-sm text-[11px] ${
                    currentProc.pm2_env.status === 'online'
                      ? 'bg-[#0d1f0d] text-[#22c55e] border border-[#22c55e]/30'
                      : 'bg-[#111] text-[#555] border border-[#1e1e1e]'
                  }`}>
                    {currentProc.pm2_env.status}
                  </span>
                  <span className="text-[#555]">
                    CPU: <span className={`${
                      currentProc.monit.cpu >= 80 ? 'text-[#ef4444]' :
                      currentProc.monit.cpu >= 50 ? 'text-[#f59e0b]' : 'text-[#22c55e]'
                    }`}>{currentProc.monit.cpu.toFixed(1)}%</span>
                  </span>
                  <span className="text-[#555]">
                    Mem: <span className="text-[#22d3ee]">{fmtMem(currentProc.monit.memory)}</span>
                  </span>
                  <span className="text-[#444] ml-auto">
                    {livePoints.length} pts · updates every {selectedLiveServer === LOCAL_CONN_ID ? '3s' : `${REMOTE_LIVE_POLL_MS / 1000}s`}
                  </span>
                </div>
              )}

              {/* Row 1: CPU Chart */}
              <div className="bg-[#111] border border-[#1e1e1e] rounded-sm p-3 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-[12px] text-[#888]">CPU Usage</p>
                    <p className="text-[11px] text-[#444]">rolling {livePoints.length} pts</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatCard label="Min" value={liveCpuStats.min} unit="%" color="text-[#22c55e]" />
                    <StatCard label="Avg" value={liveCpuStats.avg} unit="%" color="text-[#e8e8e8]" />
                    <StatCard label="Max" value={liveCpuStats.max} unit="%" color="text-[#ef4444]" />
                  </div>
                </div>
                <div className="h-36">
                  {livePoints.length > 0
                    ? <Line data={liveCpuChart} options={chartOptions('%', 100)} />
                    : <div className="h-full flex items-center justify-center text-[12px] text-[#555]">
                        Waiting for data...
                      </div>
                  }
                </div>
              </div>

              {/* Row 2: Memory Chart */}
              <div className="bg-[#111] border border-[#1e1e1e] rounded-sm p-3 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-[12px] text-[#888]">Memory Usage</p>
                    <p className="text-[11px] text-[#444]">rolling {livePoints.length} pts</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatCard label="Min" value={liveMemStats.min} unit="MB" color="text-[#22c55e]" />
                    <StatCard label="Avg" value={liveMemStats.avg} unit="MB" color="text-[#22d3ee]" />
                    <StatCard label="Max" value={liveMemStats.max} unit="MB" color="text-[#ef4444]" />
                  </div>
                </div>
                <div className="h-36">
                  {livePoints.length > 0
                    ? <Line data={liveMemChart} options={chartOptions('MB')} />
                    : <div className="h-full flex items-center justify-center text-[12px] text-[#555]">
                        Waiting for data...
                      </div>
                  }
                </div>
              </div>
            </div>

          </div>
          )}
        </div>
      )}

      {/* ════════════════════ HISTORY TAB ════════════════════ */}
      {tab === 'history' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-0.5">
              <label className="text-[11px] text-[#555] uppercase tracking-[0.12em]">{t('remoteMetrics.connection')}</label>
              <select
                value={selectedConn}
                onChange={e => setSelectedConn(e.target.value)}
                className={selectCls}
              >
                {connections.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-0.5">
              <label className="text-[11px] text-[#555] uppercase tracking-[0.12em]">{t('remoteMetrics.process')}</label>
              <select
                value={selectedHistProc}
                onChange={e => setSelectedHistProc(e.target.value)}
                disabled={histProcs.length === 0}
                className={selectCls}
              >
                {histProcs.length === 0
                  ? <option value="">—</option>
                  : histProcs.map(p => <option key={p} value={p}>{p}</option>)
                }
              </select>
            </div>

            <div className="flex flex-col gap-0.5">
              <label className="text-[11px] text-[#555] uppercase tracking-[0.12em]">Range</label>
              <div className="flex gap-1">
                {TIME_RANGES.map((r, i) => (
                  <button
                    key={r.label}
                    onClick={() => setRangeIdx(i)}
                    className={`text-[12px] px-2 py-1 rounded-sm transition-colors ${
                      rangeIdx === i
                        ? 'bg-[#1a2e1a] border border-[#22c55e]/40 text-[#22c55e]'
                        : 'bg-[#111] border border-[#1e1e1e] text-[#555] hover:text-[#888] hover:border-[#333]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-0.5 ml-auto">
              <label className="text-[11px] text-[#555] uppercase tracking-[0.12em]">Auto-refresh (30s)</label>
              <button
                onClick={() => setAutoRefresh(v => !v)}
                className={`self-start text-[12px] px-3 py-1.5 rounded-sm border transition-colors ${
                  autoRefresh
                    ? 'bg-[#0d1f0d] border-[#22c55e]/40 text-[#22c55e]'
                    : 'border-[#1e1e1e] text-[#555] hover:text-[#888] hover:border-[#333]'
                }`}
              >
                {autoRefresh ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Empty states */}
          {!selectedConn && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ChartBarIcon className="h-11 w-11 text-[#333] mb-3" />
              <p className="text-[12px] text-[#555]">{t('remoteMetrics.selectConnection')}</p>
              <p className="text-[12px] text-[#444] mt-1">{t('remoteMetrics.metricsRecorded')}</p>
            </div>
          )}

          {selectedConn && !selectedHistProc && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-1">
              <p className="text-[12px] text-[#555]">
                {selectedConn === LOCAL_CONN_ID
                  ? t('metricsPage.noLocalDataYet')
                  : t('remoteMetrics.noProcesses')}
              </p>
              {selectedConn === LOCAL_CONN_ID && (
                <p className="text-[12px] text-[#444]">{t('metricsPage.localHint')}</p>
              )}
            </div>
          )}

          {/* Charts */}
          {selectedConn && selectedHistProc && (
            <>
              {/* History CPU Chart */}
              <div className="bg-[#111] border border-[#1e1e1e] rounded-sm p-3">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[12px] text-[#888]">CPU Usage</p>
                    <p className="text-[11px] text-[#444]">{histMetrics.length} data points</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatCard label="Min" value={histCpuStats.min} unit="%" color="text-[#22c55e]" />
                    <StatCard label="Avg" value={histCpuStats.avg} unit="%" color="text-[#e8e8e8]" />
                    <StatCard label="Max" value={histCpuStats.max} unit="%" color="text-[#ef4444]" />
                  </div>
                </div>
                <div className="h-40">
                  {histMetrics.length > 0
                    ? <Line data={histCpuChart} options={chartOptions('%', 100)} />
                    : <div className="h-full flex items-center justify-center text-[12px] text-[#555]">
                        No data for selected range
                      </div>
                  }
                </div>
              </div>

              {/* History Memory Chart */}
              <div className="bg-[#111] border border-[#1e1e1e] rounded-sm p-3">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[12px] text-[#888]">Memory Usage</p>
                    <p className="text-[11px] text-[#444]">{histMetrics.length} data points</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatCard label="Min" value={histMemStats.min} unit="MB" color="text-[#22c55e]" />
                    <StatCard label="Avg" value={histMemStats.avg} unit="MB" color="text-[#22d3ee]" />
                    <StatCard label="Max" value={histMemStats.max} unit="MB" color="text-[#ef4444]" />
                  </div>
                </div>
                <div className="h-40">
                  {histMetrics.length > 0
                    ? <Line data={histMemChart} options={chartOptions('MB')} />
                    : <div className="h-full flex items-center justify-center text-[12px] text-[#555]">
                        No data for selected range
                      </div>
                  }
                </div>
              </div>

              {/* Raw table */}
              <div className="bg-[#111] border border-[#1e1e1e] rounded-sm overflow-hidden">
                <div className="px-3 py-2 border-b border-[#1e1e1e]">
                  <p className="text-[12px] text-[#888]">
                    Recent Samples (last 20)
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left border-b border-[#1e1e1e]">
                        <th className="px-3 py-2 text-[11px] text-[#555] uppercase tracking-[0.12em] font-normal">Time</th>
                        <th className="px-3 py-2 text-[11px] text-[#555] uppercase tracking-[0.12em] font-normal">CPU</th>
                        <th className="px-3 py-2 text-[11px] text-[#555] uppercase tracking-[0.12em] font-normal">Memory</th>
                        <th className="px-3 py-2 text-[11px] text-[#555] uppercase tracking-[0.12em] font-normal">Memory (bytes)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {[...histMetrics].reverse().slice(0, 20).map(m => (
                        <tr key={m.id} className="hover:bg-[#141414] transition-colors">
                          <td className="px-3 py-1.5 text-[12px] text-[#555] tabular-nums">
                            {new Date(m.timestamp).toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-[12px] tabular-nums">
                            <span className={m.cpu >= 80 ? 'text-[#ef4444]' : m.cpu >= 50 ? 'text-[#f59e0b]' : 'text-[#22c55e]'}>
                              {m.cpu.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-[12px] text-[#22d3ee] tabular-nums">
                            {m.memory_mb.toFixed(2)} MB
                          </td>
                          <td className="px-3 py-1.5 text-[12px] text-[#444] tabular-nums">
                            {m.memory_bytes.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MetricsPage;
