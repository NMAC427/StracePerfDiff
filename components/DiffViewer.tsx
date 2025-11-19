import React, { useState, useMemo } from 'react';
import { DiffRow, TraceLine } from '../types';
import { Clock, Cpu, AlertCircle, ChevronsRight, AlignLeft } from 'lucide-react';

interface DiffViewerProps {
  diffRows: DiffRow[];
  selectedPids: Set<number>;
}

// Helper to format small duration
const fmtTime = (s?: number) => {
  if (s === undefined) return '-';
  if (s === 0) return '0';
  if (s < 0.0001) return (s * 1000000).toFixed(0) + 'µs';
  if (s < 1) return (s * 1000).toFixed(2) + 'ms';
  return s.toFixed(3) + 's';
};

const RowContent: React.FC<{ line?: TraceLine; highlight?: boolean; label: string; showPid: boolean }> = ({ line, highlight, label, showPid }) => {
  if (!line) return <div className="h-full bg-slate-950/30" />;

  return (
    <div className={`
      flex flex-col px-3 py-2 text-xs font-mono border-l-2 h-full
      ${highlight ? 'border-rose-500 bg-rose-500/5' : 'border-slate-800 hover:bg-slate-800/30'}
    `}>
      <div className="flex items-center justify-between mb-1 opacity-70">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{label}</span>
          {showPid && line.pid !== undefined && line.pid > 0 && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400">
              PID {line.pid}
            </span>
          )}
          <span className="text-[10px] text-slate-500">{line.timestamp}</span>
        </div>
        <span className="text-[10px] text-slate-500">+{fmtTime(line.timestampEpoch/1000)}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold text-indigo-300">{line.syscall}</span>
        <span className="text-slate-400 break-all whitespace-pre-wrap leading-relaxed" title={line.args}>{line.args}</span>
      </div>
      <div className="flex items-center justify-end gap-3 mt-2">
        <div className="flex items-center gap-1 text-slate-500" title="Wait time before syscall (User CPU time)">
            <Cpu size={10} />
            <span>{fmtTime(line.userDiff)}</span>
        </div>
        <div className={`flex items-center gap-1 font-bold ${line.duration > 0.001 ? 'text-amber-400' : 'text-slate-400'}`} title="Syscall Execution Time">
            <Clock size={10} />
            <span>{fmtTime(line.duration)}</span>
        </div>
      </div>
    </div>
  );
};

export const DiffViewer: React.FC<DiffViewerProps> = ({ diffRows, selectedPids }) => {
  const [filterSlow, setFilterSlow] = useState(false);

  const displayRows = useMemo(() => {
    // Step 1: Filter by PID
    const pidFiltered = diffRows.filter(r => {
        // A row matches if:
        // 1. It has an 'A' side and A's PID is selected
        // 2. OR It has a 'B' side and B's PID is selected
        // 3. Note: PID 0 is default.
        
        const pidA = r.a?.pid ?? 0;
        const pidB = r.b?.pid ?? 0;
        
        const showA = r.a ? selectedPids.has(pidA) : false;
        const showB = r.b ? selectedPids.has(pidB) : false;
        
        // If type is insert (only B), check B.
        // If type is delete (only A), check A.
        // If type match/mismatch, check either (usually same PID, but maybe not if aligned across threads?)
        // Simplified: Show if any present side matches filter.
        if (r.type === 'insert') return showB;
        if (r.type === 'delete') return showA;
        return showA || showB;
    });

    // Step 2: Filter Slow
    if (!filterSlow) return pidFiltered.slice(0, 1000); 
    
    return pidFiltered.filter(r => (r.a?.duration || 0) > 0.001 || (r.b?.duration || 0) > 0.001).slice(0, 1000);
  }, [diffRows, filterSlow, selectedPids]);

  const showPid = useMemo(() => {
      return diffRows.some(r => (r.a?.pid && r.a.pid > 0) || (r.b?.pid && r.b.pid > 0));
  }, [diffRows]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                <AlignLeft size={18} />
            </div>
            <h3 className="font-semibold text-slate-200">Execution Flow Diff</h3>
            <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-xs rounded-full">
                {displayRows.length} Ops shown
            </span>
        </div>
        <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-slate-200">
                <input 
                    type="checkbox" 
                    checked={filterSlow} 
                    onChange={e => setFilterSlow(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                />
                Only Slow Calls (&gt;1ms)
            </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="min-w-[800px]">
            {/* Header */}
            <div className="grid grid-cols-12 gap-0 sticky top-0 z-10 text-xs font-medium text-slate-500 bg-slate-950 border-b border-slate-800">
                <div className="col-span-5 p-2 pl-4 text-center border-r border-slate-800">Trace A</div>
                <div className="col-span-2 p-2 text-center bg-slate-900/50">Comparison</div>
                <div className="col-span-5 p-2 pr-4 text-center border-l border-slate-800">Trace B</div>
            </div>

            {/* Rows */}
            {displayRows.map((row, idx) => {
                let bgClass = idx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/50';
                let statusIcon = <ChevronsRight size={14} className="text-slate-600" />;
                let diffText = null;

                if (row.type === 'mismatch') {
                    bgClass = 'bg-amber-500/5';
                    statusIcon = <AlertCircle size={14} className="text-amber-500" />;
                } else if (row.type === 'insert') {
                    bgClass = 'bg-cyan-500/5';
                    statusIcon = <div className="text-[10px] font-bold text-cyan-500 px-1 rounded bg-cyan-500/10">INS</div>;
                } else if (row.type === 'delete') {
                    bgClass = 'bg-rose-500/5';
                    statusIcon = <div className="text-[10px] font-bold text-rose-500 px-1 rounded bg-rose-500/10">DEL</div>;
                } else if (row.type === 'match') {
                    const delta = row.timeDiff || 0;
                    const absDelta = Math.abs(delta);
                    const isSignificant = absDelta > 0.0001; // 100us
                    
                    if (isSignificant) {
                        const faster = delta > 0 ? 'B' : 'A';
                        const diffColor = faster === 'B' ? 'text-emerald-400' : 'text-rose-400';
                        
                        diffText = (
                            <span className={`text-[10px] font-mono ${diffColor}`}>
                                {faster === 'B' ? '-' : '+'}{fmtTime(absDelta)}
                            </span>
                        );
                    }
                }

                return (
                    <div key={idx} className={`grid grid-cols-12 border-b border-slate-800/50 min-h-[60px] ${bgClass}`}>
                        <div className="col-span-5">
                             {row.type !== 'insert' && <RowContent line={row.a} label="A" highlight={row.type === 'delete'} showPid={showPid} />}
                        </div>
                        
                        <div className="col-span-2 flex flex-col items-center justify-center gap-1 border-x border-slate-800/30 p-1">
                             {statusIcon}
                             {diffText}
                        </div>

                        <div className="col-span-5">
                            {row.type !== 'delete' && <RowContent line={row.b} label="B" highlight={row.type === 'insert'} showPid={showPid} />}
                        </div>
                    </div>
                );
            })}
            {diffRows.length > 1000 && !filterSlow && (
                <div className="p-4 text-center text-slate-500 text-sm italic">
                    ... {diffRows.length - 1000} more rows hidden for performance. Use filters.
                </div>
            )}
        </div>
      </div>
    </div>
  );
};