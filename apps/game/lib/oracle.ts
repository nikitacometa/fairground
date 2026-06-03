/**
 * The Terminal Oracle — deadpan, intellectually-unhinged one-liners the "protocol" mutters while
 * the VRF resolves. Each line is a small artifact (screenshot-bait alongside the proof card). The
 * register is dry, smart, occasionally a non-sequitur — never a slot-machine "you almost won".
 *
 * Lines are picked deterministically from a seed (the commit round) so a given flip's wait is
 * "curated" and reproducible, not slot-machine noise.
 */
export const ORACLE_LINES: readonly string[] = [
  'The sha-256 function does not know you chose heads. It does not know you exist.',
  'Randomness is just determinism that has not been bribed yet.',
  'The house has no opinion. The house has a balance sheet.',
  'This flip will be witnessed by every full node on Earth. None of them care.',
  'You could leave. The coin lands regardless. It does not require an audience.',
  'Your odds are exactly 50%. This is the most honest sentence you will read today.',
  'Somewhere a validator is dreaming of your transaction. It will not remember this.',
  'The beacon chooses. Without malice, without mercy, without you.',
  'Probability has been notified. It declined to favor anyone.',
  'Heads and tails are political constructs. The hash is not.',
  'Fairness is not a feeling. It is a constraint. You are inside it now.',
  'No prayer has ever altered a SHA-256 digest. Many have tried. We have logs.',
  'The outcome already exists. It is simply being decrypted from the future.',
  'There is no croupier. There is only arithmetic, and arithmetic does not blink.',
  'Your wallet signed without hesitation. Interpret that however you must.',
  'The coin is neither up nor down. It is between states, like your portfolio.',
  'Consensus is forming. It was not asked for your input.',
  'Entropy was harvested from a beacon that has never met you. This is for the best.',
  'A node in Reykjavik just confirmed a round. It did this for you. It does not know your name.',
  'The math is indifferent. The math is also undefeated.',
  'You are not unlucky. You are sampling a distribution. The distribution is sampling you back.',
  'This is not a casino. Casinos can be wrong on purpose. We cannot.',
  'The protocol has run this exact scenario 2^256 times. None of them involved you specifically.',
  'Belief does not propagate across the network. Only signatures do.',
  'The dealer is a 256-bit number. It has no tells. It has no hands.',
  'Every coin you have ever flipped agrees: the past has no vote here.',
  'Your strategy is noted, archived, and ignored, in that order.',
  'The beacon emits randomness on a schedule. The schedule is not negotiable. Neither is the randomness.',
  'Hope is not a cryptographic primitive. We checked.',
  'You chose a side. The universe finds this charming and irrelevant.',
  'Somewhere this exact bet resolved differently. You do not live there.',
  'The chain remembers everything and forgives nothing. It is, in this way, like a cat.',
  'The result is being computed by a function with no memory of last time. Lucky you. Or not.',
  'A coin has two sides. A hash has 2^256. We are using the small one for your comfort.',
  'The treasury is solvent and unbothered. Aspire to this.',
  'Your conviction has been measured at 0 bits. This is normal.',
  'No edge can be gained here, only discovered to never have existed.',
  'The flip is fair. This is, statistically, the least fun way to lose.',
  'Determinism is just God refusing to roll dice. We rolled them anyway.',
  'The beacon does not want you to win. The beacon does not want you to lose. The beacon wants nothing. Be like the beacon.',
  'This wait is not punishment. It is the proof being assembled in your honor.',
  'Eight blocks of finality stand between you and an answer. They will not be rushed.',
  'Schrödinger ran a smaller experiment. His cat had better odds of attention.',
  'You are funding the heat death of the universe one transaction at a time. Thank you.',
  'The outcome is not random to the beacon. It is only random to you. This asymmetry is called fairness.',
  'A losing flip and a winning flip cost the same and weigh the same. Only you assign them meaning.',
  'The house edge is 3%. The house ego is zero. Learn from the house.',
  'Your transaction is in the air. The air is mathematical. Do not breathe it.',
  'No one is coming to tilt the coin. We removed that feature. It was the whole feature, elsewhere.',
  'The VRF is verifiable, which means even your loss comes with a receipt.',
  'Consensus imminent. The network has reached agreement about you without consulting you.',
  'You may feel watched. You are. By every node. Indifferently.',
  'The coin owes you nothing and is paying it back in full.',
  'Cryptography is just trust with the trust removed.',
  'The result will be true whether or not you find it agreeable.',
  'This is the only fair fight in crypto, which is why it feels so strange.',
  'A number is being born. It will outlive your interest in it.',
  'The protocol is older than your patience and younger than your debts.',
  'Heads is a hypothesis. Tails is a hypothesis. The hash is a verdict.',
  'You are about to learn something true. Brace accordingly.',
  'Forty-eight hours from now you could refund this. The coin finds your distrust adorable.',
  'The beacon has spoken to no one and is about to speak to you. Do not take it personally.',
  'Every flip is independent. So, increasingly, are you.',
  'The chain does not do comebacks. It does not do anything twice.',
] as const;

/** Deterministic line sequence from a seed (commit round). Avoids immediate repeats. */
export function oracleSequence(seed: bigint, count: number): string[] {
  const lines = ORACLE_LINES;
  let x = Number(((seed % 2147483629n) + 2147483629n) % 2147483629n) || 1;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const out: string[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count && out.length < lines.length; i++) {
    let idx = next() % lines.length;
    let guard = 0;
    while (used.has(idx) && guard++ < lines.length) idx = (idx + 1) % lines.length;
    used.add(idx);
    out.push(lines[idx]!);
  }
  return out;
}
