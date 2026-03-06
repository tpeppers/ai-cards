// ── Diff Types and Algorithms ──────────────────────────────────────
// Extracted from StrategyComparison.tsx for reuse by TracingTab.

export type DiffLineType = 'same' | 'added' | 'removed' | 'changed' | 'comment' | 'blank';
export type DiffLine = { text: string; type: DiffLineType };
export type DiffResult = { left: DiffLine[]; right: DiffLine[] };
export type DiffHunk = { id: number; start: number; length: number; checkboxSide: 'left' | 'right' };

export const isComment = (line: string): boolean => line.trimStart().startsWith('#');

export function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i].trim() === b[j].trim()) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const matches: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].trim() === b[j].trim()) {
      matches.push([i, j]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

export function computeDiff(textA: string, textB: string): DiffResult {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');

  // Build index maps for non-comment, non-blank lines
  const contentA: { idx: number; text: string }[] = [];
  const contentB: { idx: number; text: string }[] = [];
  linesA.forEach((line, i) => {
    if (!isComment(line) && line.trim() !== '') contentA.push({ idx: i, text: line });
  });
  linesB.forEach((line, i) => {
    if (!isComment(line) && line.trim() !== '') contentB.push({ idx: i, text: line });
  });

  const matches = lcs(contentA.map(c => c.text), contentB.map(c => c.text));

  // Build sets of matched original indices
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  const matchPairs: [number, number][] = matches.map(([ci, cj]) => {
    const origA = contentA[ci].idx;
    const origB = contentB[cj].idx;
    matchedA.add(origA);
    matchedB.add(origB);
    return [origA, origB];
  });

  // Walk both arrays building aligned output
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let ai = 0, bi = 0, mi = 0;

  while (ai < linesA.length || bi < linesB.length) {
    // If we're at a match pair, emit it
    if (mi < matchPairs.length && ai === matchPairs[mi][0] && bi === matchPairs[mi][1]) {
      left.push({ text: linesA[ai], type: 'same' });
      right.push({ text: linesB[bi], type: 'same' });
      ai++; bi++; mi++;
      continue;
    }

    // Emit unmatched lines before the next match
    const nextMatchA = mi < matchPairs.length ? matchPairs[mi][0] : linesA.length;
    const nextMatchB = mi < matchPairs.length ? matchPairs[mi][1] : linesB.length;

    const unmatchedA: string[] = [];
    const unmatchedB: string[] = [];
    while (ai < nextMatchA) { unmatchedA.push(linesA[ai]); ai++; }
    while (bi < nextMatchB) { unmatchedB.push(linesB[bi]); bi++; }

    // Pair up changed lines, then emit remaining as added/removed
    const pairCount = Math.min(unmatchedA.length, unmatchedB.length);
    for (let k = 0; k < pairCount; k++) {
      const lineA = unmatchedA[k];
      const lineB = unmatchedB[k];
      const typeA = isComment(lineA) ? 'comment' : lineA.trim() === '' ? 'blank' : 'changed';
      const typeB = isComment(lineB) ? 'comment' : lineB.trim() === '' ? 'blank' : 'changed';
      // If both are comments or blanks, keep them as-is
      if ((typeA === 'comment' || typeA === 'blank') && (typeB === 'comment' || typeB === 'blank')) {
        left.push({ text: lineA, type: typeA });
        right.push({ text: lineB, type: typeB });
      } else {
        left.push({ text: lineA, type: isComment(lineA) ? 'comment' : 'changed' });
        right.push({ text: lineB, type: isComment(lineB) ? 'comment' : 'changed' });
      }
    }
    for (let k = pairCount; k < unmatchedA.length; k++) {
      const line = unmatchedA[k];
      left.push({ text: line, type: isComment(line) ? 'comment' : line.trim() === '' ? 'blank' : 'removed' });
      right.push({ text: '', type: 'blank' });
    }
    for (let k = pairCount; k < unmatchedB.length; k++) {
      const line = unmatchedB[k];
      left.push({ text: '', type: 'blank' });
      right.push({ text: line, type: isComment(line) ? 'comment' : line.trim() === '' ? 'blank' : 'added' });
    }
  }

  return { left, right };
}

export function isHunkLine(diff: DiffResult, i: number): boolean {
  const l = diff.left[i];
  const r = diff.right[i];
  if (l.type === 'same' && r.type === 'same') return false;
  if (l.type === 'blank' && r.type === 'blank') return false;
  if (l.type === 'comment' && r.type === 'comment' && l.text.trim() === r.text.trim()) return false;
  return l.type !== 'same' || r.type !== 'same';
}

export function identifyHunks(diff: DiffResult): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let id = 0;
  let i = 0;
  while (i < diff.left.length) {
    if (isHunkLine(diff, i)) {
      const start = i;
      while (i < diff.left.length && isHunkLine(diff, i)) i++;
      const length = i - start;
      // Check if this hunk has any real (non-comment, non-blank) changes
      let hasRealChange = false;
      let rightAllBlank = true;
      for (let j = start; j < start + length; j++) {
        const l = diff.left[j];
        const r = diff.right[j];
        // Real change = at least one side is not comment/blank
        if (!((l.type === 'comment' || l.type === 'blank') && (r.type === 'comment' || r.type === 'blank'))) {
          hasRealChange = true;
        }
        if (r.type !== 'blank') {
          rightAllBlank = false;
        }
      }
      if (hasRealChange) {
        hunks.push({ id: id++, start, length, checkboxSide: rightAllBlank ? 'left' : 'right' });
      }
    } else {
      i++;
    }
  }
  return hunks;
}

export function buildEffectiveText(diff: DiffResult, hunks: DiffHunk[], disabledHunkIds: Set<number>): string {
  const hunkLineMap = new Map<number, DiffHunk>();
  for (const h of hunks) {
    for (let i = h.start; i < h.start + h.length; i++) {
      hunkLineMap.set(i, h);
    }
  }

  const lines: string[] = [];
  for (let i = 0; i < diff.left.length; i++) {
    const hunk = hunkLineMap.get(i);
    if (hunk && disabledHunkIds.has(hunk.id)) {
      // Disabled hunk: take left-side text (original), skip blank fillers
      if (diff.left[i].type !== 'blank' && diff.left[i].text !== '') {
        lines.push(diff.left[i].text);
      }
    } else {
      // Enabled hunk or non-hunk: take right-side text, skip blank fillers
      if (diff.right[i].type !== 'blank' && diff.right[i].text !== '') {
        lines.push(diff.right[i].text);
      } else if (diff.right[i].type === 'same' || (!hunk && diff.left[i].type === 'same')) {
        // Same lines: take the text
        lines.push(diff.right[i].text);
      }
    }
  }
  return lines.join('\n');
}
