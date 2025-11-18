export interface TraceLine {
  id: number;
  timestamp: string; // Original string timestamp
  timestampEpoch: number; // Converted to relative ms from start
  syscall: string;
  args: string;
  result: string;
  duration: number; // System time in seconds
  userDiff: number; // Estimated user processing time before this call (gap from prev end)
  raw: string;
}

export interface TraceStats {
  totalLines: number;
  totalWallTime: number;
  totalSysTime: number;
  totalUserTime: number;
  syscallCounts: Record<string, { count: number; totalDuration: number }>;
}

export interface DiffRow {
  type: 'match' | 'mismatch' | 'insert' | 'delete' | 'gap';
  a?: TraceLine;
  b?: TraceLine;
  timeDiff?: number; // Difference in duration (A - B)
  userDiffDelta?: number; // Difference in user gap (A - B)
}

export interface ParsedTrace {
  filename: string;
  lines: TraceLine[];
  stats: TraceStats;
}
