import React from 'react';
import { Check, Filter } from 'lucide-react';

interface PidSelectorProps {
  allPids: number[];
  selectedPids: Set<number>;
  onToggle: (pid: number) => void;
  onToggleAll: (select: boolean) => void;
}

export const PidSelector: React.FC<PidSelectorProps> = ({ 
  allPids, 
  selectedPids, 
  onToggle,
  onToggleAll
}) => {
  if (allPids.length <= 1) return null;

  const allSelected = allPids.every(pid => selectedPids.has(pid));

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900 border border-slate-800 rounded-xl">
      <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider font-semibold mr-2">
        <Filter size={14} />
        Filter Processes
      </div>
      
      <button
        onClick={() => onToggleAll(!allSelected)}
        className={`
          px-3 py-1 text-xs font-medium rounded-full transition-colors border
          ${allSelected 
            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/30' 
            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}
        `}
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>

      <div className="w-px h-4 bg-slate-700 mx-1" />

      {allPids.map(pid => {
        const isSelected = selectedPids.has(pid);
        return (
          <button
            key={pid}
            onClick={() => onToggle(pid)}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all
              ${isSelected 
                ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/20' 
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'}
            `}
          >
            {isSelected && <Check size={10} />}
            PID {pid === 0 ? 'Main' : pid}
          </button>
        );
      })}
    </div>
  );
};