import { TraceLine, TraceStats, ParsedTrace, DiffRow } from '../types';

// Regex to parse: 21:55:34.211679 mmap(NULL, 8192, ...) = 0x... <0.000046>
const STRACE_REGEX = /^(\d+:\d+:\d+\.\d+)\s+(\w+)\((.*)\)\s+=\s+(.+?)\s+<([\d\.]+)>/;

const parseTimestamp = (ts: string): number => {
  const [h, m, s] = ts.split(':');
  return (parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)) * 1000;
};

export const parseStrace = (content: string, filename: string): ParsedTrace => {
  const lines: TraceLine[] = [];
  const rawLines = content.split('\n');
  const syscallCounts: Record<string, { count: number; totalDuration: number }> = {};
  
  let startTime = 0;
  let prevEndTime = 0;

  let validLineCount = 0;

  rawLines.forEach((raw, index) => {
    const match = raw.match(STRACE_REGEX);
    if (match) {
      const [, timestampStr, syscall, args, result, durationStr] = match;
      const currentEpoch = parseTimestamp(timestampStr);
      const duration = parseFloat(durationStr);

      if (validLineCount === 0) {
        startTime = currentEpoch;
        prevEndTime = currentEpoch; // Assume starts immediately
      }

      // User diff is the time elapsed since the previous syscall finished until this one started
      let userDiff = 0;
      if (validLineCount > 0) {
        userDiff = Math.max(0, currentEpoch - prevEndTime);
      }

      // Update prevEndTime for next iteration
      prevEndTime = currentEpoch + (duration * 1000);

      const line: TraceLine = {
        id: index,
        timestamp: timestampStr,
        timestampEpoch: currentEpoch - startTime,
        syscall,
        args,
        result,
        duration,
        userDiff: userDiff / 1000, // Store in seconds to match duration
        raw
      };

      lines.push(line);

      // Stats
      if (!syscallCounts[syscall]) {
        syscallCounts[syscall] = { count: 0, totalDuration: 0 };
      }
      syscallCounts[syscall].count++;
      syscallCounts[syscall].totalDuration += duration;

      validLineCount++;
    }
  });

  const totalSysTime = lines.reduce((acc, l) => acc + l.duration, 0);
  const totalUserTime = lines.reduce((acc, l) => acc + l.userDiff, 0);
  const totalWallTime = lines.length > 0 ? (lines[lines.length - 1].timestampEpoch / 1000) + lines[lines.length - 1].duration : 0;

  return {
    filename,
    lines,
    stats: {
      totalLines: lines.length,
      totalWallTime,
      totalSysTime,
      totalUserTime,
      syscallCounts
    }
  };
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