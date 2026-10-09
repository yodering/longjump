// Player names are public on the leaderboard and in rooms. Keep them short,
// ASCII and hard to impersonate; moderators can still rename or ban.
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'system', 'longjump', 'server', 'support', 'staff', 'official'];
// Substrings that rarely appear inside innocent names. Moderation handles the rest.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'faggot', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'chink', 'whore', 'slut', 'porn', 'penis', 'vagina'];
const FOLD: Record<string, string> = { '0': 'o', '1': 'l', i: 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', vv: 'w', rn: 'm' };

/** Uniqueness key: case, underscores and common look-alikes do not make a different name. */
export function nameKey(name: string) {
  return name.toLowerCase().replace(/_/g, '').replace(/vv|rn|[0134578i]/g, match => FOLD[match]);
}

export function nameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(name)) return 'Use 3–16 letters, numbers or underscores.';
  const key = nameKey(name), plain = name.toLowerCase().replace(/_/g, '');
  if (key.length < 3) return 'Use at least 3 letters or numbers.';
  if (RESERVED.some(word => key === nameKey(word))) return 'That name is reserved.';
  // Check both spellings: folding turns i into l, which would hide words containing i.
  const unfolded = plain.replace(/[0134578]/g, match => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' })[match]!);
  if (BLOCKED.some(word => unfolded.includes(word) || key.includes(nameKey(word)))) return 'Choose a different name.';
  return null;
}
