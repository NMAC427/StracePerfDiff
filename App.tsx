import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Zap, BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import { FileUpload } from './components/FileUpload';
import { SummaryCard } from './components/SummaryCard';
import { DiffViewer } from './components/DiffViewer';
import { parseStrace, alignTraces } from './services/traceService';
import { ParsedTrace, DiffRow } from './types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const App: React.FC = () => {
  const [traceA, setTraceA] = useState<ParsedTrace | null>(null);
  const [traceB, setTraceB] = useState<ParsedTrace | null>(null);
  const [diffResult, setDiffResult] = useState<DiffRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isChartExpanded, setIsChartExpanded] = useState(true);

  const handleFileA = (content: string, name: string) => {
    const parsed = parseStrace(content, name);
    setTraceA(parsed);
  };

  const handleFileB = (content: string, name: string) => {
    const parsed = parseStrace(content, name);
    setTraceB(parsed);
  };

  useEffect(() => {
    if (traceA && traceB) {
      setIsProcessing(true);
      // Timeout to allow UI to render the loading state
      setTimeout(() => {
        const aligned = alignTraces(traceA, traceB);
        setDiffResult(aligned);
        setIsProcessing(false);
      }, 100);
    }
  }, [traceA, traceB]);

  const chartData = useMemo(() => {
    if (!traceA || !traceB) return [];
    
    // Combine keys
    const allSyscalls = new Set([
      ...Object.keys(traceA.stats.syscallCounts),
      ...Object.keys(traceB.stats.syscallCounts)
    ]);

    const data = Array.from(allSyscalls).map(syscall => {
      const infoA = traceA.stats.syscallCounts[syscall] || { count: 0, totalDuration: 0 };
      const infoB = traceB.stats.syscallCounts[syscall] || { count: 0, totalDuration: 0 };
      
      return {
        name: syscall,
        timeA: infoA.totalDuration,
        timeB: infoB.totalDuration,
        countA: infoA.count,
        countB: infoB.count,
        delta: infoB.totalDuration - infoA.totalDuration
      };
    });

    // Sort by biggest time difference magnitude
    return data.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
  }, [traceA, traceB]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6 flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-center justify-between pb-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-900/20">
            <Activity className="text-white" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              StracePerfDiff
            </h1>
            <p className="text-slate-500 text-sm">System Call Performance Analyzer</p>
          </div>
        </div>
        <div className="flex gap-4">
            <div className="text-right">
                <div className="text-xs text-slate-500 font-mono">Trace A</div>
                <div className="text-sm font-medium text-indigo-400">{traceA ? traceA.filename : 'Not Loaded'}</div>
            </div>
            <div className="w-px bg-slate-800 mx-2"></div>
             <div className="text-right">
                <div className="text-xs text-slate-500 font-mono">Trace B</div>
                <div className="text-sm font-medium text-cyan-400">{traceB ? traceB.filename : 'Not Loaded'}</div>
            </div>
        </div>
      </header>

      {/* File Inputs */}
      {(!traceA || !traceB) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 items-center justify-center max-w-4xl mx-auto w-full py-12">
          <div className="space-y-4">
             <h2 className="text-xl font-semibold text-slate-300 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">A</span>
                Baseline Trace
             </h2>
             <FileUpload 
               label="Upload Trace A (strace output)" 
               onFileSelect={handleFileA} 
               fileName={traceA?.filename}
             />
          </div>
          <div className="space-y-4">
             <h2 className="text-xl font-semibold text-slate-300 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs">B</span>
                Comparison Trace
             </h2>
             <FileUpload 
               label="Upload Trace B (strace output)" 
               onFileSelect={handleFileB} 
               fileName={traceB?.filename}
             />
          </div>
        </div>
      )}

      {/* Dashboard */}
      {traceA && traceB && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Summary Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard 
              title="Total Wall Time" 
              valA={traceA.stats.totalWallTime} 
              valB={traceB.stats.totalWallTime} 
              unit="s"
            />
            <SummaryCard 
              title="Kernel Time (Syscalls)" 
              valA={traceA.stats.totalSysTime} 
              valB={traceB.stats.totalSysTime} 
              unit="s"
            />
            <SummaryCard 
              title="User Processing Time" 
              valA={traceA.stats.totalUserTime} 
              valB={traceB.stats.totalUserTime} 
              unit="s"
            />
            <SummaryCard 
              title="Total Ops" 
              valA={traceA.stats.totalLines} 
              valB={traceB.stats.totalLines} 
              inverse={false}
              formatter={(v) => Math.floor(v).toLocaleString()}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Charts */}
            <div className="lg:col-span-1 flex flex-col gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm overflow-hidden transition-all duration-200">
                    <button 
                        onClick={() => setIsChartExpanded(!isChartExpanded)}
                        className="w-full flex items-center justify-between p-5 hover:bg-slate-800/50 transition-colors"
                    >
                        <h3 className="text-slate-400 text-sm font-semibold flex items-center gap-2">
                            <BarChart2 size={16} />
                            Top Syscall Time Diffs (Aggregated)
                        </h3>
                        {isChartExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                    </button>
                    
                    {isChartExpanded && (
                        <div className="px-5 pb-5 h-[300px] w-full text-xs border-t border-slate-800/50 pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                                    <XAxis type="number" stroke="#94a3b8" tickFormatter={(v) => v.toFixed(3) + 's'} />
                                    <YAxis type="category" dataKey="name" stroke="#cbd5e1" width={80} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                                        itemStyle={{ color: '#e2e8f0' }}
                                        formatter={(val: number) => val.toFixed(5) + 's'}
                                        cursor={{ fill: 'transparent' }}
                                    />
                                    <Legend />
                                    <Bar dataKey="timeA" name="Time A" fill="#818cf8" stackId="a" />
                                    <Bar dataKey="timeB" name="Time B" fill="#22d3ee" stackId="b" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="space-y-4">
                         <h3 className="text-slate-400 text-sm font-semibold mb-2">Diff Analysis</h3>
                         <p className="text-sm text-slate-400 leading-relaxed">
                            Comparing <span className="text-indigo-400 font-medium">{traceA.filename}</span> vs <span className="text-cyan-400 font-medium">{traceB.filename}</span>.
                         </p>
                         <ul className="space-y-2 text-sm">
                            <li className="flex items-center justify-between p-2 rounded bg-slate-950/50">
                                <span className="text-slate-500">Total Skew</span>
                                <span className={`font-mono font-medium ${traceB.stats.totalWallTime > traceA.stats.totalWallTime ? 'text-rose-400' : 'text-emerald-400'}`}>
                                    {(traceB.stats.totalWallTime - traceA.stats.totalWallTime).toFixed(4)}s
                                </span>
                            </li>
                            <li className="flex items-center justify-between p-2 rounded bg-slate-950/50">
                                <span className="text-slate-500">Ops Delta</span>
                                <span className="font-mono font-medium text-slate-300">
                                    {traceB.stats.totalLines - traceA.stats.totalLines}
                                </span>
                            </li>
                         </ul>
                         <div className="mt-4 p-3 bg-slate-800/30 rounded border border-slate-800 text-xs text-slate-500">
                            <p>
                                Note: "User Processing Time" is inferred from the gap between system calls. 
                                Large gaps indicate the application logic is busy or blocked on non-traced events.
                            </p>
                         </div>
                    </div>
                </div>
            </div>

            {/* Right: Diff Viewer */}
            <div className="lg:col-span-2 h-[600px] lg:h-[calc(100vh-240px)] min-h-[500px]">
                {isProcessing ? (
                    <div className="h-full flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl">
                        <div className="flex flex-col items-center gap-3 animate-pulse">
                            <Zap size={32} className="text-indigo-500" />
                            <span className="text-slate-400">Aligning traces and calculating diffs...</span>
                        </div>
                    </div>
                ) : (
                    <DiffViewer diffRows={diffResult} />
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;