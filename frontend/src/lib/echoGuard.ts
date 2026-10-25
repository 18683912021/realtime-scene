export function normalizeSpeech(value: string): string {
  return value.toLowerCase().replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
}

export function longestCommonSubstring(a: string, b: string): number {
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

/**
 * Browser speech recognition can listen through its own capture path, so the
 * echoCancellation flag on our getUserMedia stream does not necessarily keep
 * the TTS out of the transcript. A transcript that is largely a substring of
 * what Mira just said is almost certainly her own voice, not a user barge-in.
 */
export function looksLikeAgentEcho(text: string, agentLine: string): boolean {
  const heard = normalizeSpeech(text);
  const spoken = normalizeSpeech(agentLine);
  if (!heard || !spoken) return false;
  // Short replies such as "嗯" "对" "好呀" are normal backchannels. Filtering
  // them because the same characters appear somewhere in a long reply makes
  // the mic feel dead right after Mira finishes speaking. Only substantial
  // overlaps are treated as self-echo.
  if (heard.length < 5) return false;
  const common = longestCommonSubstring(heard, spoken);
  return common >= 4 && common / heard.length >= 0.65;
}
