import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  valA: number;
  valB: number;
  unit?: string;
  inverse?: boolean; // If true, lower is better (default: true for time)
  formatter?: (v: number) => string;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ 
  title, 
  valA, 
  valB, 
  unit = '', 
  inverse = true,
  formatter = (v) => v.toFixed(4)
}) => {
  const diff = valB - valA;
  const percent = valA !== 0 ? (diff / valA) * 100 : 0;
  
  // Determine color logic
  // If inverse (Time), then Positive Diff (B > A) is BAD (Red). Negative Diff (B < A) is GOOD (Green).
  // If not inverse (Throughput), Positive Diff is GOOD (Green).
  
  let colorClass = 'text-slate-400';
  let Icon = Minus;

  if (Math.abs(percent) > 0.1) {
    if (inverse) {
      if (diff > 0) {
        colorClass = 'text-rose-400'; // Slower
        Icon = ArrowUpRight;
      } else {
        colorClass = 'text-emerald-400'; // Faster
        Icon = ArrowDownRight;
      }
    } else {
      if (diff > 0) {
        colorClass = 'text-emerald-400'; // More
        Icon = ArrowUpRight;
      } else {
        colorClass = 'text-rose-400'; // Less
        Icon = ArrowDownRight;
      }
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
      <h3 className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-3">{title}</h3>
      
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-indigo-400 text-xs font-mono">A:</span>
            <span className="text-lg font-medium text-slate-200 font-mono">
              {formatter(valA)}{unit}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-cyan-400 text-xs font-mono">B:</span>
            <span className="text-lg font-medium text-slate-200 font-mono">
              {formatter(valB)}{unit}
            </span>
          </div>
        </div>

        <div className={`flex flex-col items-end ${colorClass}`}>
          <div className="flex items-center gap-1 text-2xl font-bold">
            {Math.abs(diff) > 0.00001 ? (
               <>
                 <Icon size={20} strokeWidth={3} />
                 {Math.abs(percent).toFixed(1)}%
               </>
            ) : (
               <span className="text-slate-600 text-lg">--</span>
            )}
          </div>
          <div className="text-xs opacity-80 font-mono">
            {diff > 0 ? '+' : ''}{formatter(diff)}{unit}
          </div>
        </div>
      </div>
    </div>
  );
};