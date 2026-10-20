import { normalizeName } from './core.js';

export async function historyFingerprint(name, month) {
  const bytes = new TextEncoder().encode(`book-buzz-history-v1|${month}|${normalizeName(name)}`);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function applyHistory(dataset, history, shouldApply = () => true) {
  const earlier = history.months;
  const lookups = earlier.map(month => new Set(month.voters));
  const results = await Promise.all(dataset.ballots.map(async ballot => {
    const matches = [];
    if (ballot.identity) {
      for (let i = 0; i < earlier.length; i++) {
        if (lookups[i].has(await historyFingerprint(ballot.identity, earlier[i].id))) matches.push(earlier[i].label);
      }
    }
    const returning = ballot.historyDecision === 'returning' || (ballot.historyDecision !== 'noMatch' && matches.length > 0);
    return { months: matches, returning, checked: earlier.length > 0, claimedNew: ballot.attendance === 'new', conflict: returning && ballot.attendance === 'new', attendanceReview: returning && ballot.attendance === 'notAttended' };
  }));
  if (shouldApply()) dataset.ballots.forEach((ballot, index) => { ballot.history = results[index]; });
  return dataset;
}

export function historyDescription(ballot) {
  if (ballot.historyDecision === 'returning') return 'Returning voter — confirmed by organizer.';
  if (ballot.historyDecision === 'noMatch') return 'No earlier vote — confirmed by organizer.';
  if (ballot.history?.returning) return `Previously voted: ${ballot.history.months.join(', ')}.`;
  if (ballot.history?.checked) return 'No earlier vote found in the loaded semester history. Spelling variants may need correction.';
  return 'No voting history is loaded. New-member status is unverified.';
}
