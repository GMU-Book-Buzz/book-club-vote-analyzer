import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistory, earlierMonths, historyFingerprint } from '../src/history.js';
import { parseRows, selectBallots } from '../src/core.js';
import saved from '../src/semester-history.js';

const history = {
  semester: 'Fall 2026', start: '2026-09', end: '2026-12', defaultMonth: '2026-11',
  months: [
    { id: '2026-09', label: 'September 2026', voters: [await historyFingerprint('Alice', '2026-09')] },
    { id: '2026-10', label: 'October 2026', voters: [await historyFingerprint('Bob', '2026-10')] },
  ],
};
const make = () => parseRows([
  ['Name', 'Have you attended a meeting?', 'Rank [A]', 'Rank [B]'],
  [' ALICE ', "I'm a brand new member!!", '1', '2'],
  ['Bob', 'No', '2', '1'],
  ['Carol', "I'm a brand new member!!", '1', '2'],
]);
test('semester lookup validates new-member claims against all earlier elections', async () => {
  const data = await applyHistory(make(), history, '2026-11');
  assert.deepEqual(data.ballots[0].history.months, ['September 2026']);
  assert.equal(data.ballots[0].history.conflict, true);
  assert.equal(data.ballots[2].history.returning, false);
  assert.equal(data.ballots[2].history.checked, true);
  const selected = selectBallots(data, { historyMode: true, attendance: ['new'] });
  assert.deepEqual(selected.included.map(row => row.ballot.name), ['Carol']);
  assert.equal(selected.rows[0].effectiveAttendance, 'returning');
});
test('same and future elections and other semesters do not establish prior membership', async () => {
  const data = await applyHistory(make(), history, '2026-10');
  assert.equal(data.ballots[0].history.returning, true);
  assert.equal(data.ballots[1].history.returning, false);
  assert.equal(earlierMonths(history, '2026-09').length, 0);
  assert.equal(earlierMonths(history, '2027-11').length, 0);
  await applyHistory(data, history, '2027-11');
  assert.equal(data.ballots[0].history.checked, false);
});
test('history overrides and corrected names update membership without changing original attendance', async () => {
  const data = make(); data.ballots[0].historyDecision = 'noMatch';
  await applyHistory(data, history, '2026-11');
  assert.equal(data.ballots[0].history.conflict, false);
  assert.equal(data.ballots[0].attendance, 'new');
  data.ballots[2].historyDecision = 'returning';
  await applyHistory(data, history, '2026-11');
  assert.equal(data.ballots[2].history.conflict, true);
  delete data.ballots[0].historyDecision;
  data.ballots[0].name = 'Different'; data.ballots[0].identity = 'different';
  await applyHistory(data, history, '2026-11');
  assert.equal(data.ballots[0].history.returning, false);
});
test('saved lookup contains only month metadata and hashed identities', () => {
  assert.deepEqual(saved.months.map(month => [month.id, month.voters.length]), [['2026-09', 27], ['2026-10', 33]]);
  saved.months.forEach(month => {
    assert.deepEqual(Object.keys(month).sort(), ['id', 'label', 'voters']);
    assert.equal(new Set(month.voters).size, month.voters.length);
    month.voters.forEach(value => assert.match(value, /^[a-f0-9]{64}$/));
  });
});
test('an obsolete history calculation does not overwrite a newer result', async () => {
  const data = await applyHistory(make(), history, '2026-11');
  await applyHistory(data, history, '2026-09', () => false);
  assert.equal(data.ballots[0].history.returning, true);
});
