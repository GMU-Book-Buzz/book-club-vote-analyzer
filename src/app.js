import { attendanceLabels, normalizeName, validateRanks, duplicateGroups, members, compareMembers, selectBallots, rankedPairs } from './core.js';

const $ = id => document.getElementById(id);
const allCombinations = () => Object.keys(attendanceLabels).flatMap(key => [`${key}:both`, `${key}:currentOnly`]);
const state = { current: null, past: null, links: {}, attendance: Object.keys(attendanceLabels), combinations: allCombinations(), returningOnly: false, issuesOnly: false };
const jobs = {}, files = {};
let editing = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, id, className = 'secondary') {
  const node = el('button', text, className);
  node.type = 'button';
  node.dataset.action = action;
  if (id !== undefined) node.dataset.id = id;
  return node;
}
function option(text, value, selected = false) {
  const node = el('option', text); node.value = value; node.selected = selected; return node;
}
function notice(text, success = false) { return el('div', text, `notice${success ? ' success' : ''}`); }
function table(headers) {
  const wrap = el('div', null, 'table-wrap'), node = el('table'), head = el('thead'), row = el('tr'), body = el('tbody');
  headers.forEach(text => { const cell = el('th', text); cell.scope = 'col'; row.append(cell); });
  head.append(row); node.append(head, body); wrap.append(node);
  return { wrap, body };
}
function stopJob(kind) {
  if (!jobs[kind]) return;
  clearTimeout(jobs[kind].timer); jobs[kind].worker.terminate(); delete jobs[kind];
}
function status(kind, message, error = false) {
  $(`${kind}-status`).textContent = message;
  $(`${kind}-status`).classList.toggle('error-text', error);
}

async function loadFile(kind, file, entry = null, nameColumn) {
  stopJob(kind);
  state[kind] = null;
  state.links = {};
  state.combinations = allCombinations();
  state.returningOnly = false;
  $('returning-only').checked = false;
  files[kind] = file;
  $(`${kind}-picker`).replaceChildren();
  $('global-message').replaceChildren();
  render();
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { status(kind, 'This file is over 10 MB. Export a smaller response sheet.', true); return; }
  if (!/\.(zip|csv)$/i.test(file.name)) { status(kind, 'Please choose a .zip or .csv file.', true); return; }
  status(kind, `Reading ${file.name}…`);
  const worker = new Worker(new URL('./import-worker.js', import.meta.url));
  const job = { worker, timer: setTimeout(() => {
    stopJob(kind); status(kind, 'This file took too long to read. Try exporting a fresh CSV.', true);
  }, 15000) };
  jobs[kind] = job;
  worker.onerror = () => { if (jobs[kind] !== job) return; stopJob(kind); status(kind, 'The file reader could not start. Reload the page and try again.', true); };
  worker.onmessage = ({ data }) => {
    if (jobs[kind] !== job) return;
    stopJob(kind);
    if (data.error) { status(kind, data.error, true); return; }
    if (data.nameColumns) {
      status(kind, 'Choose the column containing full names. No attendance or ranking columns are required for a past month.');
      const area = el('div', null, 'file-picker'), label = el('label', 'Member-name column'), select = el('select');
      select.id = 'past-name-column'; label.htmlFor = select.id;
      data.nameColumns.forEach((header, index) => select.append(option(header || `Column ${index + 1}`, String(index))));
      const choose = button('Use this name column', 'choose-name');
      choose.addEventListener('click', () => loadFile('past', file, data.entry, Number(select.value)));
      area.append(label, select, choose); $('past-picker').append(area); return;
    }
    if (data.entries) {
      status(kind, `${data.entries.length} CSVs found. Choose the response sheet below.`);
      const area = el('div', null, 'file-picker'), label = el('label', 'Response CSV'), select = el('select');
      select.id = `${kind}-entry`; label.htmlFor = select.id;
      data.entries.forEach(name => select.append(option(name, name)));
      const choose = button('Use this CSV', 'choose-csv', kind);
      area.append(label, select, choose); $(`${kind}-picker`).append(area); return;
    }
    state[kind] = data.dataset;
    status(kind, `${data.dataset.filename} · ${data.dataset.ballots.length} responses${kind === 'past' ? ' · names ready for comparison' : ` · ${data.dataset.books.length} books`}`);
    if (kind === 'current') {
      state.attendance = Object.keys(attendanceLabels);
      document.querySelectorAll('#attendance-filters input').forEach(input => { input.checked = true; });
    }
    render();
  };
  try { const buffer = await file.arrayBuffer(); if (jobs[kind] === job) worker.postMessage({ buffer, filename: file.name, entry, kind, nameColumn }, [buffer]); }
  catch { if (jobs[kind] === job) { stopJob(kind); status(kind, 'Could not open that file. Choose it again.', true); } }
}

for (const [key, label] of Object.entries(attendanceLabels)) {
  const node = el('label', null, 'check'), input = el('input');
  input.type = 'checkbox'; input.value = key; input.checked = true;
  input.addEventListener('change', () => { state.attendance = [...document.querySelectorAll('#attendance-filters input:checked')].map(input => input.value); render(); });
  node.append(input, document.createTextNode(label)); $('attendance-filters').append(node);
}
for (const kind of ['current', 'past']) $(`${kind}-file`).addEventListener('change', event => {
  const file = event.target.files[0]; if (file) loadFile(kind, file);
  event.target.value = '';
});
$('remove-past').addEventListener('click', () => {
  stopJob('past'); state.past = null; state.links = {}; state.returningOnly = false; delete files.past;
  $('returning-only').checked = false; $('past-picker').replaceChildren(); status('past', 'Book selections can be different between months.'); render();
});
$('returning-only').addEventListener('change', event => { state.returningOnly = event.target.checked; render(); });
$('issues-only').addEventListener('change', event => { state.issuesOnly = event.target.checked; render(); });
$('follow-filters').addEventListener('click', () => {
  state.current?.ballots.forEach(ballot => { delete ballot.manualSelection; if (ballot.decision === 'exclude') ballot.decision = 'pending'; });
  render();
});

function renderCombinations() {
  const host = $('combination-filters'); host.replaceChildren();
  $('combination-section').hidden = !state.past;
  if (!state.past) return;
  const { wrap, body } = table(['Current-month attendance', 'Voted in both months', 'This month only']);
  for (const [key, name] of Object.entries(attendanceLabels)) {
    const row = el('tr'); row.append(el('td', name));
    for (const [participation, label] of [['both', 'Voted in both months'], ['currentOnly', 'This month only']]) {
      const cell = el('td'), input = el('input'), value = `${key}:${participation}`;
      input.type = 'checkbox'; input.checked = state.combinations.includes(value);
      input.setAttribute('aria-label', `${name} + ${label}`);
      input.dataset.combination = value;
      input.addEventListener('change', () => {
        state.combinations = input.checked ? [...state.combinations, value] : state.combinations.filter(item => item !== value);
        render();
        [...host.querySelectorAll('input')].find(node => node.dataset.combination === value)?.focus({ preventScroll: true });
      });
      cell.append(input); row.append(cell);
    }
    body.append(row);
  }
  host.append(wrap);
}

function renderDuplicates(kind) {
  const host = $(`${kind}-duplicates`); host.replaceChildren();
  const dataset = state[kind]; if (!dataset) return;
  for (const [key, group] of duplicateGroups(dataset)) {
    const box = el('div', null, 'duplicate-box');
    box.append(el('strong', `${kind === 'past' ? 'Past month: ' : ''}${group[0].name} — ${group.length} submissions`));
    box.append(el('p', 'Choose one response, or confirm these are different people. Unresolved current-month groups are not counted.'));
    const label = el('label', 'Use submission: '), select = el('select');
    select.setAttribute('aria-label', `${kind} duplicate: ${group[0].name}`);
    select.append(option('Choose a submission…', '', !dataset.duplicateDecisions[key]));
    group.forEach(ballot => select.append(option(`CSV row ${ballot.row} · ${ballot.timestamp || 'No timestamp'}`, ballot.id, dataset.duplicateDecisions[key] === ballot.id)));
    select.append(option('These are different people — keep each', 'distinct', dataset.duplicateDecisions[key] === 'distinct'));
    select.addEventListener('change', () => {
      if (select.value) dataset.duplicateDecisions[key] = select.value; else delete dataset.duplicateDecisions[key];
      state.links = {}; render();
    });
    label.append(select); box.append(label);
    const detail = el('details'), summary = el('summary', 'Compare the submissions'); detail.append(summary);
    group.forEach(ballot => {
      detail.append(el('p', `Row ${ballot.row} · ${ballot.name} · ${ballot.attendanceAnswer}`));
      const list = el('ul'); dataset.books.forEach((book, index) => list.append(el('li', `${book}: ${ballot.original[index] || 'Unranked'}`))); detail.append(list);
    });
    box.append(detail); host.append(box);
  }
}

function renderResults(selection, result, pastPending) {
  const host = $('results'); host.replaceChildren();
  const winner = el('div', null, 'card winner-card'), label = el('p', '03 / THE RESULT', 'eyebrow'); winner.append(label);
  const provisional = selection.unresolved > 0 || pastPending;
  const title = !result.tiers.length ? 'No eligible ballots' : result.tiers[0].map(index => state.current.books[index]).join(' / ');
  winner.append(el('h2', title, 'winner-title'));
  winner.append(el('p', !result.tiers.length ? 'Include a valid ballot or adjust the filters to calculate a result.' : result.tiers[0].length > 1 ? 'Tied for first · your club can decide how to resolve the tie.' : 'Your Book of the Month · Ranked Pairs Margin'));
  if (provisional) winner.append(notice(`Provisional result. ${selection.unresolved ? `${selection.unresolved} eligible ballot${selection.unresolved === 1 ? ' still needs' : 's still need'} review. ` : ''}${pastPending ? 'Resolve past-month duplicate names before relying on the returning-voters filter.' : ''}`));
  else if (selection.included.some(row => row.ballot.corrected || row.ballot.decision === 'include')) winner.append(el('p', 'Includes organizer corrections or overrides. Review the ballot table for details.', 'hint'));
  const metrics = el('div', null, 'metric-strip');
  [[selection.included.length, 'ballots counted'], [selection.rows.length - selection.included.length, 'excluded / filtered'], [state.current.books.length, 'books']].forEach(([number, name]) => {
    const metric = el('div'); metric.append(el('strong', number), el('span', name)); metrics.append(metric);
  }); winner.append(metrics);
  const ranking = el('div', null, 'card'); ranking.append(el('p', 'THE FULL RANKING', 'eyebrow'));
  const list = el('ol', null, 'ranking');
  result.tiers.forEach((tier, index) => {
    tier.forEach(book => { const row = el('li'); row.append(el('span', String(index + 1).padStart(2, '0'), 'rank-number'), el('span', `${state.current.books[book]}${tier.length > 1 ? ' · tied' : ''}`)); list.append(row); });
  });
  if (!result.tiers.length) ranking.append(el('p', 'The ranking will appear when at least one ballot is eligible.'));
  ranking.append(list, el('p', 'Filters apply to the entire election, including every head-to-head comparison.', 'hint'));
  host.append(winner, ranking);
}

function renderBallots(selection) {
  $('review-count').textContent = `${selection.rows.filter(row => !row.validation.valid || !row.ballot.identity).length} flagged`;
  const host = $('ballots'); host.replaceChildren();
  const duplicates = new Set(duplicateGroups(state.current).map(([key]) => key));
  const rows = selection.rows.filter(row => !state.issuesOnly || !row.validation.valid || !row.ballot.identity || row.ballot.corrected || row.ballot.decision !== 'pending' || duplicates.has(row.ballot.identity));
  if (!rows.length) { host.append(notice('No ballots need attention. Uncheck the option above to review all responses.', true)); return; }
  const { wrap, body } = table(['Count ballot', 'Member & features', 'Status', 'Preferences & notes', 'Organizer decision']);
  for (const row of rows) {
    const { ballot, validation } = row, tr = el('tr');
    tr.className = row.included ? 'ballot-counted' : 'ballot-excluded';
    const countCell = el('td'), check = el('input');
    check.type = 'checkbox'; check.checked = row.included; check.disabled = !row.canSelect;
    check.dataset.action = 'toggle-ballot'; check.dataset.id = ballot.id;
    check.setAttribute('aria-label', `Count ballot: ${ballot.name || `row ${ballot.row}`} (row ${ballot.row})`);
    check.addEventListener('change', () => {
      ballot.manualSelection = check.checked;
      ballot.decision = check.checked ? 'include' : 'exclude';
      render();
    });
    countCell.append(check);
    const member = el('td', ballot.name || 'Missing name'); member.append(el('small', `CSV row ${ballot.row} · ${attendanceLabels[ballot.attendance]}`));
    member.append(el('small', row.participation === 'both' ? 'Voted in both months' : row.participation === 'currentOnly' ? 'This month only' : 'Past month not loaded'));
    if (ballot.timestamp) member.append(el('small', ballot.timestamp));
    if (ballot.manualSelection !== undefined) member.append(el('small', 'Manual selection · overrides filters'));
    const statusCell = el('td'); statusCell.append(el('span', row.included ? 'Counted' : row.unresolved ? 'Needs review' : 'Excluded', `status-pill ${row.unresolved ? 'warning' : row.included ? '' : 'excluded'}`));
    if (row.reason) statusCell.append(el('small', row.reason));
    if (ballot.corrected) statusCell.append(el('small', 'Corrected in this session'));
    if (ballot.decision === 'include' && !validation.valid) statusCell.append(el('small', 'Organizer override'));
    const info = el('td', null, 'ballot-detail');
    if (validation.issues.length) info.append(el('span', validation.issues.join(' ')));
    else info.append(el('span', `${validation.ranks.filter(rank => rank !== null).length} books ranked`));
    const detail = el('details'), summary = el('summary', 'View choices'); detail.append(summary);
    const list = el('ul');
    state.current.books.forEach((book, index) => list.append(el('li', `${book}: ${ballot.values[index] || 'Unranked'}${ballot.corrected ? ` (original: ${ballot.original[index] || 'Unranked'})` : ''}`)));
    detail.append(list); info.append(detail);
    if (ballot.features?.length) {
      const features = el('details'); features.append(el('summary', 'View all response fields'));
      const fields = el('ul'); ballot.features.forEach(field => fields.append(el('li', `${field.label}: ${field.value || 'Blank'}`)));
      features.append(fields); info.append(features);
    }
    const actions = el('td'), group = el('div', null, 'ballot-actions');
    if (row.canSelect && ballot.decision !== 'include') group.append(button(validation.valid ? 'Include' : 'Include as entered', 'include', ballot.id));
    if (ballot.decision !== 'exclude') group.append(button('Exclude', 'exclude', ballot.id));
    group.append(button('Correct', 'edit', ballot.id));
    if (ballot.decision !== 'pending' || ballot.corrected) group.append(button('Undo changes', 'undo', ballot.id, 'text-button'));
    actions.append(group); tr.append(countCell, member, statusCell, info, actions); body.append(tr);
  }
  host.append(wrap);
}

function renderComparison(comparison) {
  const host = $('comparison'); host.replaceChildren();
  if (!comparison) return;
  const grid = el('div', null, 'comparison-grid');
  [[comparison.both.map(pair => `${pair.current.name}${pair.current.name !== pair.past.name ? ` ↔ ${pair.past.name}` : ''}`), 'Voted in both'], [comparison.currentOnly.map(member => member.name), 'This month only'], [comparison.pastOnly.map(member => member.name), 'Past month only']].forEach(([names, label]) => {
    const block = el('div'); block.append(el('span', names.length, 'number'), el('h3', label));
    const list = el('ul'); names.forEach(name => list.append(el('li', name))); if (!names.length) list.append(el('li', 'None')); block.append(list); grid.append(block);
  }); host.append(grid);
  const details = el('details'), summary = el('summary', 'Review matches or link spelling variants'); details.append(summary);
  comparison.both.forEach(pair => {
    const row = el('div', null, 'matched-row'); row.append(el('span', `${pair.current.name} ↔ ${pair.past.name}`), button('Unlink', 'unlink', pair.current.key, 'text-button')); details.append(row);
  });
  if (comparison.currentOnly.length && comparison.pastOnly.length) {
    const controls = el('div', null, 'link-controls');
    const currentLabel = el('label', 'This month'), pastLabel = el('label', 'Past month'), currentSelect = el('select'), pastSelect = el('select');
    currentSelect.id = 'link-current'; pastSelect.id = 'link-past';
    const display = member => `${member.name}${member.key.includes('::row:') ? ` · row ${member.ballotIds[0]}` : ''}`;
    comparison.currentOnly.forEach(member => currentSelect.append(option(display(member), member.key)));
    comparison.pastOnly.forEach(member => pastSelect.append(option(display(member), member.key)));
    currentLabel.append(currentSelect); pastLabel.append(pastSelect); controls.append(currentLabel, pastLabel, button('Link these members', 'link')); details.append(controls);
  }
  if (Object.keys(state.links).length) details.append(button('Reset all manual links', 'reset-links', undefined, 'text-button'));
  details.open = Object.keys(state.links).length > 0; host.append(details);
}

function renderMethod(result) {
  const host = $('method'); host.replaceChildren();
  host.append(el('p', 'Each counted ballot gives one preference to the higher-ranked book in every pair. Unranked books are tied last; equal ranks express no preference between those books. All ballots have equal weight.'));
  host.append(el('p', 'Ranked Pairs Margin orders victories by largest margin, then smallest opposing-vote count. Exactly tied victories are considered together; new edges involved in a cycle are rejected. Books with no incoming locked defeats share the next rank. This follows Condorcet PHP’s default Ranked Pairs variant.'));
  const source = el('a', 'Read the voting method reference'); source.href = 'https://docs.condorcet.io/gh/VotingMethods#ranked-pairs-margin'; source.target = '_blank'; source.rel = 'noreferrer'; host.append(source);
  if (!result.tiers.length) return;
  host.append(el('h3', 'Head-to-head preferences'), el('p', 'A cell is the number of counted voters who preferred the row book over the column book. Tied preferences add no vote to either side.'));
  const { wrap, body } = table(['Book', ...state.current.books.map((_, i) => String(i + 1))]); wrap.classList.add('matrix');
  state.current.books.forEach((book, a) => {
    const row = el('tr'), header = el('th', `${a + 1}. ${book}`); header.scope = 'row'; row.append(header);
    state.current.books.forEach((_, b) => row.append(el('td', a === b ? '—' : result.matrix[a][b]))); body.append(row);
  }); host.append(wrap);
  if (result.condorcetWinner !== null) host.append(notice(`${state.current.books[result.condorcetWinner]} is also the Condorcet winner: it beats every other book head to head.`, true));
  host.append(el('h3', 'Victory decisions'));
  const decisions = table(['Round', 'Preference', 'Votes', 'Margin', 'Decision']);
  result.rounds.forEach((round, index) => round.forEach(edge => {
    const row = el('tr'); [index + 1, `${state.current.books[edge.from]} over ${state.current.books[edge.to]}`, `${edge.winning}–${edge.opposition}`, edge.margin, edge.accepted ? 'Locked' : 'Skipped: would form a cycle'].forEach(value => row.append(el('td', value))); decisions.body.append(row);
  }));
  if (result.rounds.length) host.append(decisions.wrap); else host.append(el('p', 'All head-to-head comparisons are tied.'));
}

function render() {
  const focus = document.activeElement;
  const focusAction = focus?.dataset.action, focusId = focus?.dataset.id;
  $('workspace').hidden = !state.current; $('empty-state').hidden = !!state.current;
  $('remove-past').hidden = !state.past && !files.past;
  $('returning-only').disabled = !state.current || !state.past;
  $('comparison-section').hidden = !state.current || !state.past;
  $('returning-hint').textContent = state.past ? 'Combines with the attendance selections above. Review name matches below.' : 'Add a past month to enable this filter.';
  if (!state.current) {
    for (const id of ['results', 'ballots', 'comparison', 'method', 'current-duplicates', 'past-duplicates', 'edit-fields']) $(id).replaceChildren();
    $('edit-name').value = ''; $('edit-title').textContent = ''; editing = null;
    return;
  }
  renderDuplicates('current'); renderDuplicates('past');
  renderCombinations();
  const comparison = state.past ? compareMembers(state.current, state.past, state.links) : null;
  const selection = selectBallots(state.current, { attendance: state.attendance, returningOnly: state.returningOnly, comparison, combinations: state.combinations });
  const result = rankedPairs(state.current.books, selection.included.map(row => row.validation.ranks));
  const pastPending = state.past && (state.returningOnly || state.combinations.length !== allCombinations().length) && duplicateGroups(state.past).some(([key]) => !state.past.duplicateDecisions[key]);
  renderResults(selection, result, pastPending); renderBallots(selection); renderComparison(comparison); renderMethod(result);
  if (focusAction) {
    const replacement = [...document.querySelectorAll('[data-action]')].find(node => node.dataset.action === focusAction && node.dataset.id === focusId)
      ?? [...document.querySelectorAll('[data-action]')].find(node => focusId && node.dataset.id === focusId);
    replacement?.focus({ preventScroll: true });
  }
}

function openEditor(id) {
  editing = state.current.ballots.find(ballot => ballot.id === id);
  $('edit-title').textContent = `Correct ${editing.name || `row ${editing.row}`}`;
  $('edit-name').value = editing.name; $('edit-error').textContent = '';
  $('edit-fields').replaceChildren();
  state.current.books.forEach((book, index) => {
    const row = el('div', null, 'edit-field'), label = el('label', book), input = el('input');
    input.type = 'number'; input.min = 1; input.max = state.current.books.length; input.step = 1; input.id = `rank-${index}`; label.htmlFor = input.id;
    const rank = validateRanks(editing.values).ranks[index]; input.value = Number.isFinite(rank) ? rank : '';
    row.append(label, input); $('edit-fields').append(row);
  }); $('edit-dialog').showModal();
}
document.addEventListener('click', event => {
  const node = event.target.closest('button[data-action]'); if (!node) return;
  const { action, id } = node.dataset;
  if (action === 'choose-csv') { loadFile(id, files[id], $(`${id}-entry`).value); return; }
  if (action === 'edit') { openEditor(id); return; }
  if (action === 'unlink') state.links[id] = null;
  else if (action === 'reset-links') state.links = {};
  else if (action === 'link') state.links[$('link-current').value] = $('link-past').value;
  else {
    const ballot = state.current?.ballots.find(ballot => ballot.id === id); if (!ballot) return;
    if (action === 'include' || action === 'exclude') { ballot.decision = action; ballot.manualSelection = action === 'include'; }
    if (action === 'undo') {
      if (ballot.originalName !== undefined) { delete state.current.duplicateDecisions[ballot.identity]; ballot.name = ballot.originalName; ballot.identity = normalizeName(ballot.name); delete state.current.duplicateDecisions[ballot.identity]; state.links = {}; }
      ballot.values = [...ballot.original]; ballot.corrected = false; ballot.decision = 'pending';
      delete ballot.manualSelection;
    }
  }
  render();
});
$('edit-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = state.current.books.map((_, index) => $(`rank-${index}`).value), validation = validateRanks(values);
  if (!validation.valid) { $('edit-error').textContent = validation.issues.join(' '); return; }
  const name = $('edit-name').value.trim(); if (!name) { $('edit-error').textContent = 'Enter the member’s name.'; return; }
  editing.originalName ??= editing.name;
  if (normalizeName(name) !== editing.identity) { delete state.current.duplicateDecisions[editing.identity]; delete state.current.duplicateDecisions[normalizeName(name)]; state.links = {}; }
  editing.name = name; editing.identity = normalizeName(name); editing.values = values; editing.corrected = true; editing.decision = 'include'; editing.manualSelection = true;
  $('edit-dialog').close(); render();
});
$('edit-cancel').addEventListener('click', () => $('edit-dialog').close());
$('reset').addEventListener('click', () => { if (state.current || state.past || files.current || files.past) $('reset-dialog').showModal(); });
$('reset-cancel').addEventListener('click', () => $('reset-dialog').close());
$('reset-confirm').addEventListener('click', () => {
  stopJob('current'); stopJob('past'); state.current = null; state.past = null; state.links = {}; state.returningOnly = false; state.issuesOnly = false; state.attendance = Object.keys(attendanceLabels); state.combinations = allCombinations();
  delete files.current; delete files.past;
  for (const kind of ['current', 'past']) { $(`${kind}-picker`).replaceChildren(); $(`${kind}-file`).value = ''; }
  status('current', 'ZIP or CSV · up to 10 MB · files stay on this device'); status('past', 'Book selections can be different between months.');
  $('returning-only').checked = false; $('issues-only').checked = false;
  document.querySelectorAll('#attendance-filters input').forEach(input => { input.checked = true; });
  $('global-message').replaceChildren(notice('Ready for a new month. All previous data and session decisions have been cleared.', true));
  $('reset-dialog').close(); render(); $('current-file').focus();
});
render();
