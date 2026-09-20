export const attendanceLabels = { attended: 'Attended a meeting', notAttended: 'Have not attended', new: 'New member', unknown: 'Unknown / missing answer' };
export const normalizeName = name => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function attendanceCategory(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (/\bnew\b/.test(text)) return 'new';
  if (/^yes\b/.test(text)) return 'attended';
  if (/^no\b/.test(text)) return 'notAttended';
  return 'unknown';
}

export function validateRanks(values, count = values.length) {
  const ranks = values.map(value => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (!/^\d+(?:\s*\((?:Most|Least) Preferred\))?$/i.test(text)) return NaN;
    const n = Number(text.match(/^\d+/)[0]);
    return Number.isInteger(n) && n >= 1 && n <= count ? n : NaN;
  });
  const issues = [];
  const invalid = ranks.some(Number.isNaN);
  const filled = ranks.filter(rank => rank !== null && !Number.isNaN(rank));
  if (invalid) issues.push(`Use whole-number ranks from 1 to ${count}, or leave a book blank.`);
  if (!filled.length) issues.push('No books ranked.');
  const duplicates = new Set(filled).size !== filled.length;
  if (duplicates) issues.push('Repeated ranks: two or more books have the same preference.');
  const sorted = [...new Set(filled)].sort((a, b) => a - b);
  if (sorted.some((rank, index) => rank !== index + 1)) issues.push('Gaps in ranks: preferences must start at 1 and continue without skipping.');
  return { ranks, issues, valid: !issues.length, canOverride: !invalid && filled.length > 0 };
}

export function nameColumns(headers) {
  return headers.flatMap((header, index) => /\bname\b/i.test(header) && !/\[[^\]]+\]\s*$/.test(header) ? [index] : []);
}

export function parseRows(rows, filename = '', { mode = 'current', nameColumn: chosenNameColumn } = {}) {
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one response.');
  const headers = rows[0].map(cell => String(cell).replace(/^\uFEFF/, '').trim());
  const books = headers.map((header, column) => ({ title: header.match(/\[([^\]]+)\]\s*$/)?.[1]?.trim(), column })).filter(book => book.title);
  if (mode !== 'past' && (books.length < 2 || books.length > 30)) throw new Error('Expected 2–30 book columns with titles in square brackets, like [Frankenstein].');
  if (mode !== 'past' && new Set(books.map(book => normalizeName(book.title))).size !== books.length) throw new Error('Two book columns have the same title. Give each book a distinct title.');
  const detected = nameColumns(headers);
  const nameColumn = chosenNameColumn ?? (detected.length === 1 ? detected[0] : -1);
  const attendanceColumn = headers.findIndex(header => /attended.*(?:meeting|event)/i.test(header));
  const timestampColumn = headers.findIndex(header => /^timestamp$/i.test(header));
  if (!Number.isInteger(nameColumn) || nameColumn < 0 || nameColumn >= headers.length) throw new Error('Select the column containing each member’s full name.');
  const ballots = [];
  rows.slice(1).forEach((row, index) => {
    if (row.every(cell => !String(cell).trim())) return;
    if (row.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${row.length} columns; expected ${headers.length}. Check its commas and quotation marks.`);
    const name = String(row[nameColumn]).trim();
    const original = books.map(book => row[book.column]);
    ballots.push({ id: String(index + 2), row: index + 2, name, identity: normalizeName(name), timestamp: timestampColumn < 0 ? '' : row[timestampColumn], attendance: attendanceCategory(row[attendanceColumn]), attendanceAnswer: row[attendanceColumn] ?? 'Not collected', features: headers.flatMap((header, column) => books.some(book => book.column === column) ? [] : [{ label: header, value: row[column] }]), original, values: [...original], decision: 'pending', corrected: false });
  });
  if (!ballots.length) throw new Error('This CSV has no responses.');
  if (ballots.length > 10000) throw new Error('Please use an export with no more than 10,000 responses.');
  return { filename, books: books.map(book => book.title), ballots, duplicateDecisions: {}, hasAttendance: attendanceColumn >= 0 };
}

export function duplicateGroups(dataset) {
  const groups = new Map();
  for (const ballot of dataset.ballots) {
    if (!ballot.identity) continue;
    const group = groups.get(ballot.identity) ?? [];
    group.push(ballot);
    groups.set(ballot.identity, group);
  }
  return [...groups].filter(([, group]) => group.length > 1);
}

export function members(dataset) {
  if (!dataset) return [];
  const list = new Map();
  for (const ballot of dataset.ballots) {
    if (!ballot.identity) continue;
    const choice = dataset.duplicateDecisions[ballot.identity];
    if (choice && choice !== 'distinct' && choice !== ballot.id) continue;
    const key = choice === 'distinct' ? `${ballot.identity}::row:${ballot.id}` : ballot.identity;
    if (!list.has(key)) list.set(key, { key, name: ballot.name, ballotIds: [] });
    list.get(key).ballotIds.push(ballot.id);
  }
  return [...list.values()];
}

export function compareMembers(current, past, links = {}) {
  const currentMembers = members(current), pastMembers = members(past);
  const pastByKey = new Map(pastMembers.map(member => [member.key, member]));
  const used = new Set(), both = [], currentOnly = [];
  // Explicit choices take priority; null deliberately unlinks an automatic match.
  const ordered = [...currentMembers].sort((a, b) => Number(Object.hasOwn(links, b.key)) - Number(Object.hasOwn(links, a.key)));
  for (const member of ordered) {
    const automatic = member.key.includes('::row:') ? null : member.key;
    const key = Object.hasOwn(links, member.key) ? links[member.key] : automatic;
    const match = pastByKey.get(key);
    if (match && !used.has(key)) { used.add(key); both.push({ current: member, past: match }); }
    else currentOnly.push(member);
  }
  return { both, currentOnly, pastOnly: pastMembers.filter(member => !used.has(member.key)) };
}

export function selectBallots(dataset, { attendance = Object.keys(attendanceLabels), returningOnly = false, comparison = null, combinations = null } = {}) {
  const duplicates = new Set(duplicateGroups(dataset).map(([key]) => key));
  const returning = new Set(comparison?.both.flatMap(pair => pair.current.ballotIds) ?? []);
  const rows = dataset.ballots.map(ballot => {
    const validation = validateRanks(ballot.values, dataset.books.length);
    let reason = '', unresolved = false;
    const choice = dataset.duplicateDecisions[ballot.identity];
    const participation = comparison ? returning.has(ballot.id) ? 'both' : 'currentOnly' : 'unavailable';
    const filterReason = !attendance.includes(ballot.attendance) ? 'Attendance filter'
      : returningOnly && !returning.has(ballot.id) ? 'Not matched in both months'
      : comparison && combinations && !combinations.includes(`${ballot.attendance}:${participation}`) ? 'Attendance + month filter' : '';
    if (ballot.manualSelection === false || ballot.decision === 'exclude') reason = 'Excluded by organizer';
    else if (filterReason && ballot.manualSelection !== true) reason = filterReason;
    else if (!ballot.identity) { reason = 'Missing member name'; unresolved = true; }
    else if (duplicates.has(ballot.identity) && !choice) { reason = 'Choose a duplicate submission'; unresolved = true; }
    else if (duplicates.has(ballot.identity) && choice !== 'distinct' && choice !== ballot.id) reason = 'Earlier / other submission';
    else if (!validation.valid && !(validation.canOverride && ballot.decision === 'include')) { reason = validation.issues.join(' '); unresolved = true; }
    const canSelect = !!ballot.identity && (validation.valid || validation.canOverride) && (!duplicates.has(ballot.identity) || choice === 'distinct' || choice === ballot.id);
    return { ballot, validation, included: !reason, reason, unresolved, participation, canSelect, filterReason };
  });
  return { rows, included: rows.filter(row => row.included), unresolved: rows.filter(row => row.unresolved).length };
}

function reachable(edges, from, target) {
  const todo = [from], visited = new Set();
  while (todo.length) {
    const node = todo.pop();
    if (node === target) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const edge of edges) if (edge.from === node) todo.push(edge.to);
  }
  return false;
}

// Condorcet PHP Ranked Pairs Margin semantics; see THIRD_PARTY_NOTICES.md.
export function rankedPairs(books, rankings) {
  const matrix = books.map(() => books.map(() => 0));
  for (const ranks of rankings) {
    if (ranks.length !== books.length || ranks.some(rank => rank !== null && (!Number.isInteger(rank) || rank < 1 || rank > books.length))) throw new Error('Invalid ballot passed to voting engine.');
    for (let a = 0; a < books.length; a++) for (let b = 0; b < books.length; b++) {
      if ((ranks[a] ?? Infinity) < (ranks[b] ?? Infinity)) matrix[a][b]++;
    }
  }
  if (!rankings.length) return { matrix, tiers: [], rounds: [], locked: [], condorcetWinner: null };
  const victories = [];
  for (let a = 0; a < books.length; a++) for (let b = 0; b < books.length; b++) {
    if (matrix[a][b] > matrix[b][a]) victories.push({ from: a, to: b, winning: matrix[a][b], opposition: matrix[b][a], margin: matrix[a][b] - matrix[b][a] });
  }
  victories.sort((a, b) => b.margin - a.margin || a.opposition - b.opposition);
  const groups = [];
  for (const edge of victories) {
    const last = groups.at(-1);
    if (last && last[0].margin === edge.margin && last[0].opposition === edge.opposition) last.push(edge);
    else groups.push([edge]);
  }
  const locked = [], rounds = [];
  for (const group of groups) {
    const virtual = [...locked, ...group];
    const decisions = group.map(edge => ({ ...edge, accepted: !reachable(virtual, edge.to, edge.from) }));
    locked.push(...decisions.filter(edge => edge.accepted));
    rounds.push(decisions);
  }
  const remaining = new Set(books.map((_, index) => index)), tiers = [];
  while (remaining.size) {
    const tier = [...remaining].filter(book => !locked.some(edge => edge.to === book && remaining.has(edge.from)));
    if (!tier.length) throw new Error('Unexpected cycle in locked graph.');
    tiers.push(tier);
    tier.forEach(book => remaining.delete(book));
  }
  const winner = books.findIndex((_, a) => books.every((_, b) => a === b || matrix[a][b] > matrix[b][a]));
  return { matrix, tiers, rounds, locked, condorcetWinner: winner < 0 ? null : winner };
}
