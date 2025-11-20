
import { TraceLine, TraceStats, ParsedTrace, DiffRow, TraceMode } from '../types';

const parseTimestamp = (ts: string): number => {
  // Strace format: HH:MM:SS.uuuuuu
  const [h, m, s] = ts.split(':');
  return (parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)) * 1000;
};

const parsePerfTimestamp = (ts: string): number => {
    // Perf format: Absolute seconds float (e.g. 673025301.272)
    return parseFloat(ts) * 1.0;
};

export const parsePerfTrace = (content: string, filename: string): ParsedTrace => {
    const rawLines = content.split('\n');
    const lines: TraceLine[] = [];
    const syscallCounts: Record<string, { count: number; totalDuration: number }> = {};
    const uniquePids = new Set<number>();
    const pidLastEndTime: Map<number, number> = new Map();

    let globalStartTime = 0;
    let hasSetStartTime = false;

    // Regex for Perf Trace
    // Example: 673025301.272 ( 0.002 ms): python/390838 brk() = 0x5fdfecd85000
    // Groups: 
    // 1: Timestamp (s)
    // 2: Duration (ms)
    // 3: Process Name
    // 4: PID
    // 5: Syscall
    // 6: Args (content inside parens)
    // 7: Result
    const perfRegex = /^(\d+\.\d+)\s+\(\s*([\d\.]+)\s+ms\):\s+(.+?)\/(\d+)\s+(\w+)\((.*)\)\s+=\s+(.*)$/;

    rawLines.forEach((rawLine, index) => {
        const trimmed = rawLine.trim();
        if (!trimmed) return;
        
        const match = trimmed.match(perfRegex);
        if (!match) return;

        const tsStr = match[1];
        const durationMs = parseFloat(match[2]);
        const pid = parseInt(match[4]);
        const syscall = match[5];
        const args = match[6];
        const result = match[7];

        const currentEpoch = parsePerfTimestamp(tsStr); // in ms
        const durationSec = durationMs / 1000;

        if (!hasSetStartTime) {
            globalStartTime = currentEpoch;
            hasSetStartTime = true;
        }

        uniquePids.add(pid);

        // Calc user diff (gap from prev end)
        // Note: Perf timestamp is typically start time.
        const prevEnd = pidLastEndTime.get(pid) || currentEpoch;
        const userDiff = Math.max(0, currentEpoch - prevEnd); // in ms

        // Update end time
        pidLastEndTime.set(pid, currentEpoch + durationMs);

        const line: TraceLine = {
            id: index,
            pid,
            timestamp: tsStr, // Keep original format string
            timestampEpoch: currentEpoch - globalStartTime, // Relative to start
            syscall,
            args,
            result,
            duration: durationSec,
            userDiff: userDiff / 1000, // Store as seconds
            raw: rawLine
        };

        lines.push(line);

        // Stats
        if (!syscallCounts[syscall]) {
            syscallCounts[syscall] = { count: 0, totalDuration: 0 };
        }
        syscallCounts[syscall].count++;
        syscallCounts[syscall].totalDuration += durationSec;
    });

    const totalSysTime = lines.reduce((acc, l) => acc + l.duration, 0);
    const totalUserTime = lines.reduce((acc, l) => acc + l.userDiff, 0);
    
    const totalWallTime = lines.length > 0 
      ? (lines[lines.length - 1].timestampEpoch / 1000) + lines[lines.length - 1].duration 
      : 0;

    return {
        filename,
        lines,
        stats: {
            totalLines: lines.length,
            totalWallTime,
            totalSysTime,
            totalUserTime,
            syscallCounts
        },
        pids: Array.from(uniquePids).sort((a, b) => a - b)
    };
};

export const parseStrace = (content: string, filename: string): ParsedTrace => {
  const rawLines = content.split('\n');
  const lines: TraceLine[] = [];
  const syscallCounts: Record<string, { count: number; totalDuration: number }> = {};
  const uniquePids = new Set<number>();
  
  // State for tracking timing per PID
  const pidLastEndTime: Map<number, number> = new Map();
  
  // State for tracking unfinished calls: Map<PID, PartialLine>
  const pendingCalls: Map<number, { 
    timestampStr: string; 
    startEpoch: number; 
    syscall: string; 
    startArgs: string; 
    rawStart: string 
  }> = new Map();

  let globalStartTime = 0;
  let hasSetStartTime = false;

  rawLines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    // 1. Extract PID if present
    // Format: "[pid 1234] 10:00:00 ..." or "10:00:00 ..."
    let pid = 0; // Default PID 0 for single thread
    let rest = trimmed;
    
    const pidMatch = rest.match(/^\[pid\s+(\d+)\]\s+(.*)/);
    if (pidMatch) {
      pid = parseInt(pidMatch[1]);
      rest = pidMatch[2];
    }

    // Track PID
    uniquePids.add(pid);

    // 2. Extract Timestamp
    // Format: "10:00:00.123456 syscall..."
    const timeMatch = rest.match(/^(\d+:\d+:\d+\.\d+)\s+(.*)/);
    if (!timeMatch) {
       // Line might be a signal or exit message without timestamp in some formats, skip for now
       return;
    }

    const timestampStr = timeMatch[1];
    const body = timeMatch[2];
    const currentEpoch = parseTimestamp(timestampStr);

    if (!hasSetStartTime) {
      globalStartTime = currentEpoch;
      hasSetStartTime = true;
    }
    
    // Initialize last end time for this PID if new
    if (!pidLastEndTime.has(pid)) {
      pidLastEndTime.set(pid, currentEpoch);
    }

    // 3. Analyze Body Type
    
    // Case A: Resumed Call
    // Format: "<... syscall resumed> args) = result <duration>"
    const resumeMatch = body.match(/^<\.\.\.\s+(\w+)\s+resumed>(.*)/);
    if (resumeMatch) {
      const syscallName = resumeMatch[1];
      const resumeRest = resumeMatch[2]; // args) = result <duration>

      // Find pending
      const pending = pendingCalls.get(pid);
      
      // Note: strict matching of syscall name ensures we don't mix up threads if log is corrupted,
      // though PID matching should be sufficient.
      if (pending && pending.syscall === syscallName) {
        // Complete the parsing
        // resumeRest looks like: `) = 0 <0.000123>` or `chars", 10) = 10 <0.001>`
        
        // Reconstruct full raw string for display
        const fullRaw = pending.rawStart + " ... " + rawLine;
        
        // Parse result and duration from resumeRest
        // Regex: `(.*)\)\s+=\s+(.+?)\s+<([\d\.]+)`
        const endMatch = resumeRest.match(/(.*)\)\s+=\s+(.+?)\s+<([\d\.]+)>/);
        
        if (endMatch) {
           const extraArgs = endMatch[1]; // could be empty if unfinished line had all args
           const result = endMatch[2];
           const duration = parseFloat(endMatch[3]);
           
           const fullArgs = (pending.startArgs + extraArgs).trim();

           // Calc user diff based on when the call *Started*
           const prevEnd = pidLastEndTime.get(pid) || pending.startEpoch;
           const userDiff = Math.max(0, pending.startEpoch - prevEnd);

           // EndTime = currentEpoch (resume time)
           pidLastEndTime.set(pid, currentEpoch);

           const line: TraceLine = {
             id: index,
             pid,
             timestamp: pending.timestampStr,
             timestampEpoch: pending.startEpoch - globalStartTime,
             syscall: syscallName,
             args: fullArgs,
             result,
             duration,
             userDiff: userDiff / 1000,
             raw: fullRaw
           };
           
           lines.push(line);
           
           // Cleanup
           pendingCalls.delete(pid);
           
           // Stats
            if (!syscallCounts[syscallName]) {
                syscallCounts[syscallName] = { count: 0, totalDuration: 0 };
            }
            syscallCounts[syscallName].count++;
            syscallCounts[syscallName].totalDuration += duration;
        }
      }
      return;
    }

    // Case B: Unfinished Call
    // Format: "syscall(args <unfinished ...>"
    const unfinishedMatch = body.match(/^(\w+)\((.*)\s+<unfinished \.\.\.>/);
    if (unfinishedMatch) {
      const syscall = unfinishedMatch[1];
      const startArgs = unfinishedMatch[2];
      
      pendingCalls.set(pid, {
        timestampStr,
        startEpoch: currentEpoch,
        syscall,
        startArgs,
        rawStart: rawLine
      });
      return;
    }

    // Case C: Standard Call
    // Format: "syscall(args) = result <duration>"
    const standardMatch = body.match(/^(\w+)\((.*)\)\s+=\s+(.+?)\s+<([\d\.]+)>/);
    if (standardMatch) {
      const syscall = standardMatch[1];
      const args = standardMatch[2];
      const result = standardMatch[3];
      const duration = parseFloat(standardMatch[4]);

      const prevEnd = pidLastEndTime.get(pid) || currentEpoch;
      const userDiff = Math.max(0, currentEpoch - prevEnd);

      // Update end time: Start + Duration (approx) or next timestamp?
      // Standard strace timestamp is start.
      // So end is roughly currentEpoch + (duration * 1000)
      pidLastEndTime.set(pid, currentEpoch + (duration * 1000));

      const line: TraceLine = {
        id: index,
        pid,
        timestamp: timestampStr,
        timestampEpoch: currentEpoch - globalStartTime,
        syscall,
        args,
        result,
        duration,
        userDiff: userDiff / 1000,
        raw: rawLine
      };

      lines.push(line);

      // Stats
      if (!syscallCounts[syscall]) {
        syscallCounts[syscall] = { count: 0, totalDuration: 0 };
      }
      syscallCounts[syscall].count++;
      syscallCounts[syscall].totalDuration += duration;
    }
  });

  // Sort lines by start timestamp to ensure chronological order 
  // (since resumed lines appear later in file but action started earlier)
  lines.sort((a, b) => a.timestampEpoch - b.timestampEpoch);

  const totalSysTime = lines.reduce((acc, l) => acc + l.duration, 0);
  const totalUserTime = lines.reduce((acc, l) => acc + l.userDiff, 0);
  
  // Wall time is roughly End of last - Start of first
  const totalWallTime = lines.length > 0 
    ? (lines[lines.length - 1].timestampEpoch / 1000) + lines[lines.length - 1].duration 
    : 0;

  return {
    filename,
    lines,
    stats: {
      totalLines: lines.length,
      totalWallTime,
      totalSysTime,
      totalUserTime,
      syscallCounts
    },
    pids: Array.from(uniquePids).sort((a, b) => a - b)
  };
};

export const parseTrace = (content: string, filename: string, mode: TraceMode): ParsedTrace => {
    if (mode === 'perf') {
        return parsePerfTrace(content, filename);
    }
    return parseStrace(content, filename);
};

// --- Alignment Helpers ---

// Simple Levenshtein for short strings (syscall names or filenames)
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const alen = a.length;
  const blen = b.length;
  
  // Optimization for simple cases
  if (alen > 40 || blen > 40) return Math.abs(alen - blen) + 5; 

  const row = new Array(alen + 1).fill(0).map((_, i) => i);
  let prev, val;

  for (let i = 1; i <= blen; i++) {
    prev = i;
    for (let j = 1; j <= alen; j++) {
      if (b[i - 1] === a[j - 1]) {
        val = row[j - 1]; // match
      } else {
        val = Math.min(row[j - 1] + 1, // substitution
              Math.min(prev + 1,     // insertion
                       row[j] + 1)); // deletion
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[alen] = prev;
  }
  return row[alen];
};

// Heuristic for Argument similarity (0 to 1)
const getArgSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a || !b) return 0;
  
  // Path heuristic: extract first quoted string containing a slash
  // e.g. openat(..., "/usr/lib/locale/locale-archive", ...)
  // matches "/usr/lib/locale/locale-archive"
  // Perf trace args might look like: filename: 0x..., or just args
  // Strace args look like: "string", ...
  
  const pathRegex = /"([^"]*\/[^"]*)"/;
  const matchA = a.match(pathRegex);
  const matchB = b.match(pathRegex);
  
  if (matchA && matchB) {
      const pathA = matchA[1];
      const pathB = matchB[1];
      
      const partsA = pathA.split('/');
      const partsB = pathB.split('/');
      
      const fileA = partsA[partsA.length - 1];
      const fileB = partsB[partsB.length - 1];
      
      // High score for filename match (ignoring path prefix)
      if (fileA === fileB && fileA.length > 0) {
          // Bonus for parent dir match
          const dirA = partsA.length > 1 ? partsA[partsA.length - 2] : '';
          const dirB = partsB.length > 1 ? partsB[partsB.length - 2] : '';
          
          if (dirA === dirB) return 1.0; // Perfect match on file and parent
          return 0.9; // Strong match even if parent dirs differ (e.g. /tmp vs /home)
      }
      
      // Fuzzy match for filename (e.g. version numbers: libprotobuf.so.32 vs .33)
      const dist = levenshtein(fileA, fileB);
      if (dist <= 2 && fileA.length > 3) {
          return 0.7;
      }
      
      // If paths are detected but filenames strongly mismatch, 
      // we return a lower score than the generic prefix match might yield
      // to avoid aligning completely different file operations.
      return 0.2;
  }

  // Default prefix/length heuristic for non-path args
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  
  if (maxLen === 0) return 1;

  let common = 0;
  // Check first 30 chars for prefix match (most significant usually)
  const checkLen = Math.min(minLen, 30);
  for(let i = 0; i < checkLen; i++) {
      if (a[i] === b[i]) common++;
      else break;
  }
  
  const prefixScore = common / Math.max(checkLen, 1);
  const lenScore = minLen / maxLen;
  
  // Weigh prefix more heavily
  return (prefixScore * 0.7) + (lenScore * 0.3);
};

const SCORE_MATCH = 10;
const SCORE_APPROX = 6; // Similar syscall name
const SCORE_MISMATCH = -10;
const SCORE_GAP = -4;
const MAX_ARG_BONUS = 5;

const calculateScore = (a: TraceLine, b: TraceLine): number => {
  // 1. Syscall Name Check
  if (a.syscall === b.syscall) {
    // Perfect syscall match
    const argScore = getArgSimilarity(a.args, b.args) * MAX_ARG_BONUS;
    return SCORE_MATCH + argScore;
  }

  // 2. Approx Syscall Match
  // e.g. fstat vs newfstatat
  const dist = levenshtein(a.syscall, b.syscall);
  if (dist <= 3 || a.syscall.includes(b.syscall) || b.syscall.includes(a.syscall)) {
    const argScore = getArgSimilarity(a.args, b.args) * (MAX_ARG_BONUS / 2);
    return SCORE_APPROX + argScore;
  }

  // 3. Mismatch
  return SCORE_MISMATCH;
};

// Banded Needleman-Wunsch Algorithm
// Optimized for performance on larger traces by only computing a band around the diagonal.
export const alignTraces = (traceA: ParsedTrace, traceB: ParsedTrace): DiffRow[] => {
  const listA = traceA.lines;
  const listB = traceB.lines;
  const n = listA.length;
  const m = listB.length;

  // Band size K.
  // Increased band size to handle larger drifts in execution flow
  const lengthDiff = Math.abs(n - m);
  const K = Math.max(200, lengthDiff + 100); 

  // Score Matrix: dp[i][j] stores max score
  // Using Map for sparse storage of the band
  // Direction encoding: 1=Diag, 2=Up(Delete A), 3=Left(Insert B)
  const directions: Map<string, number> = new Map();
  
  const getScore = (i: number, j: number, scores: Map<string, number>): number => {
      const key = `${i},${j}`;
      if (i === 0 && j === 0) return 0;
      if (i === 0) return j * SCORE_GAP;
      if (j === 0) return i * SCORE_GAP;
      return scores.get(key) ?? -Infinity;
  };

  const scores = new Map<string, number>();

  // Fill DP Table (Banded)
  for (let i = 0; i <= n; i++) {
    // Determine band range for j
    // Center of band at row i: c = i * (m/n)
    // range [c - K, c + K]
    const center = Math.floor(i * (m / n));
    const startJ = Math.max(0, center - K);
    const endJ = Math.min(m, center + K);

    for (let j = startJ; j <= endJ; j++) {
      if (i === 0 && j === 0) {
        scores.set('0,0', 0);
        continue;
      }

      // 1. Gap in A (Insert B) -> move from (i, j-1)
      let scoreLeft = -Infinity;
      if (j > 0) {
         const val = getScore(i, j - 1, scores);
         if (val !== -Infinity) scoreLeft = val + SCORE_GAP;
      }

      // 2. Gap in B (Delete A) -> move from (i-1, j)
      let scoreUp = -Infinity;
      if (i > 0) {
         const val = getScore(i - 1, j, scores);
         if (val !== -Infinity) scoreUp = val + SCORE_GAP;
      }

      // 3. Match/Mismatch -> move from (i-1, j-1)
      let scoreDiag = -Infinity;
      if (i > 0 && j > 0) {
         const val = getScore(i - 1, j - 1, scores);
         if (val !== -Infinity) {
             const matchScore = calculateScore(listA[i-1], listB[j-1]);
             scoreDiag = val + matchScore;
         }
      }

      // Choose max
      let maxScore = scoreLeft;
      let dir = 3; // Left

      if (scoreUp > maxScore) {
          maxScore = scoreUp;
          dir = 2; // Up
      }
      if (scoreDiag >= maxScore) { // Prefer match if equal or better
          maxScore = scoreDiag;
          dir = 1; // Diag
      }

      if (maxScore > -Infinity) {
          scores.set(`${i},${j}`, maxScore);
          directions.set(`${i},${j}`, dir);
      }
    }
  }

  // Traceback
  const rows: DiffRow[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
      const dir = directions.get(`${i},${j}`);
      
      // If we are stuck (out of band fallback or start), move towards 0,0
      if (dir === undefined) {
          if (i > 0 && j > 0) { i--; j--; rows.unshift({ type: 'mismatch', a: listA[i], b: listB[j] }); }
          else if (i > 0) { i--; rows.unshift({ type: 'delete', a: listA[i] }); }
          else if (j > 0) { j--; rows.unshift({ type: 'insert', b: listB[j] }); }
          else break;
          continue;
      }

      if (dir === 1) { // Diag
          i--;
          j--;
          const a = listA[i];
          const b = listB[j];
          
          const score = calculateScore(a, b);
          
          if (score > 0) {
              rows.unshift({
                  type: 'match',
                  a,
                  b,
                  timeDiff: a.duration - b.duration,
                  userDiffDelta: a.userDiff - b.userDiff
              });
          } else {
              rows.unshift({ type: 'mismatch', a, b });
          }
      } else if (dir === 2) { // Up (Delete A)
          i--;
          rows.unshift({ type: 'delete', a: listA[i] });
      } else if (dir === 3) { // Left (Insert B)
          j--;
          rows.unshift({ type: 'insert', b: listB[j] });
      }
  }

  return rows;
};
