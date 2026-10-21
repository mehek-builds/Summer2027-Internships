// Audience restrictions do not establish either the role type or its work term.
export function roleTitle(title) {
  return String(title ?? '')
    .replace(/\(\s*for\s+[^()]{1,160}\binterns?\s+only\s*\)/gi, ' ')
    .replace(/\s*-\s*for\s+[^()]{1,160}\binterns?\s+only\s*$/i, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function isInternshipRole(title) {
  return /\bintern(ship)?s?\b|\bco-?op\b(?!\s*city)/i.test(roleTitle(title));
}

export const TERM_BUCKETS = [
  ['summer2027', 'Summer 2027 stated in the role title'],
  ['other', 'Other stated terms'],
  ['unspecified', 'Term incomplete or not stated'],
];

export function postingTerm(title) {
  const text = roleTitle(title).toLowerCase()
    .replace(/\b(spring|summer|fall|autumn|winter)(20\d{2})\b/g, '$1 $2')
    .replace(/\b(20\d{2})(spring|summer|fall|autumn|winter)\b/g, '$1 $2');
  const years = new Set(text.match(/\b20\d{2}\b/g) ?? []);
  const seasons = new Set((text.match(/\b(spring|summer|fall|autumn|winter)\b/g) ?? []).map(value => value === 'autumn' ? 'fall' : value));
  if (years.size !== 1 || seasons.size !== 1) return 'unspecified';
  // Require an explicit association. A graduation year elsewhere in the title is not a term.
  const association = /\b(spring|summer|fall|autumn|winter)(?:\s+(?:intern(?:ship)?s?|co-?op)(?:\s+program)?)?[\s/-]*(20\d{2})\b(?!\s+graduates?\b)|\b(20\d{2})[\s/-]*(spring|summer|fall|autumn|winter)\b/;
  if (!association.test(text)) return 'unspecified';
  return years.has('2027') && seasons.has('summer') ? 'summer2027' : 'other';
}

export function partitionTerms(jobs) {
  const buckets = new Map(TERM_BUCKETS.map(([key]) => [key, []]));
  for (const job of jobs) buckets.get(postingTerm(job.title)).push(job);
  return buckets;
}
