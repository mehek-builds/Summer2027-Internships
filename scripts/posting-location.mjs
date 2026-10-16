// Evaluate the individual posting, never another member of its title group.
// The feed's country field distinguishes US/non-US/unknown, not Canada.
const normalize = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const foreignNames = [];
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b);
  if (code === 'US' || code === 'CA') continue;
  const name = countryNames.of(code);
  if (name) foreignNames.push(normalize(name));
}
foreignNames.push('united kingdom', 'uk', 'u.k.', 'uae', 'deutschland', 'south korea', 'north korea');
const foreign = new RegExp(`(?:^|[^a-z])(?:${foreignNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:$|[^a-z])`, 'i');
const canada = /\b(canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|yukon|nunavut|northwest territories)\b|\b(?:toronto|ottawa|waterloo),\s*on\b|\bvancouver,\s*bc\b|\bmontreal,\s*qc\b|\b(?:calgary|edmonton),\s*ab\b|\bwinnipeg,\s*mb\b|\bhalifax,\s*ns\b/i;
const explicitUS = /\b(united states(?: of america)?|usa)\b|\bu\.s\.(?:a\.)?/i;
export function eligiblePostingLocation(posting) {
  const location = normalize(posting.location);
  if (!location.trim() || foreign.test(location)) return false;
  if (canada.test(location)) return true;
  if (explicitUS.test(location)) return true;
  // A bare remote label or ambiguous state token is not geographic evidence.
  return posting.job_country === 'us';
}
