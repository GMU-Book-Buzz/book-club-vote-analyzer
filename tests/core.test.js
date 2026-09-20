import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, validateRanks, rankedPairs, compareMembers, selectBallots, duplicateGroups, normalizeName } from '../src/core.js';

const headers = ['Timestamp', 'What is your full name?', 'Have you attended a Book Buzz meeting or event this semester?', 'Rank [A]', 'Rank [B]', 'Rank [C]'];
const make = rows => parseRows([headers, ...rows.map(row => ['today', ...row])]);
test('past imports only require names and permit explicit column mapping', () => {
  const past = parseRows([['Timestamp', 'What is your full name?', 'Old question'], ['yesterday', 'Alice', 'anything']], 'past.csv', { mode: 'past' });
  assert.equal(past.ballots[0].name, 'Alice');
  assert.equal(past.ballots[0].attendance, 'unknown');
  assert.equal(past.books.length, 0);
  assert.equal(parseRows([['Respondent', 'Favorite'], ['Bob', 'x']], '', { mode: 'past', nameColumn: 0 }).ballots[0].name, 'Bob');
});
test('combination filters and manual selections', () => {
  const current = make([['Alice', 'No', '1', '2', '3'], ['Bob', 'No', '1', '2', '3'], ['Carol', 'Yes', '1', '2', '3']]);
  const past = parseRows([['Name'], ['Alice'], ['Carol']], '', { mode: 'past' });
  const comparison = compareMembers(current, past), combinations = ['notAttended:currentOnly', 'attended:both'];
  assert.deepEqual(selectBallots(current, { comparison, combinations }).included.map(row => row.ballot.name), ['Bob', 'Carol']);
  current.ballots[0].manualSelection = true;
  assert.equal(selectBallots(current, { comparison, combinations }).included.length, 3);
  current.ballots[2].manualSelection = false;
  assert.deepEqual(selectBallots(current, { comparison, combinations }).included.map(row => row.ballot.name), ['Alice', 'Bob']);
  current.ballots[0].values = ['bad', '', ''];
  assert.equal(selectBallots(current, { comparison, combinations }).rows[0].canSelect, false);
});
test('partial ballots, labels, ties, gaps, invalid values and empty ballots', () => {
  assert.equal(validateRanks(['1 (Most Preferred)', '2', '']).valid, true);
  assert.equal(validateRanks(['', '6', '7'], 7).canOverride, true);
  assert.match(validateRanks(['', '6', '7'], 7).issues.join(), /Gaps/);
  assert.match(validateRanks(['1', '1', '2']).issues.join(), /Repeated/);
  for (const value of ['1.5', '-1', '0', '4', '1x', 'Infinity', 'NaN']) assert.equal(validateRanks([value, '2', '']).canOverride, false);
  assert.equal(validateRanks(['', '', '']).canOverride, false);
});
test('CSV shape, changing book titles, quoted names and unknown attendance', () => {
  const data = make([['A, Person', 'Yes :)', '1', '2', '3'], ['B', 'Maybe', '', '1', '']]);
  assert.deepEqual(data.books, ['A', 'B', 'C']);
  assert.equal(data.ballots[0].name, 'A, Person');
  assert.equal(data.ballots[1].attendance, 'unknown');
  assert.throws(() => parseRows([headers, ['too', 'short']]), /CSV row 2/);
  assert.throws(() => parseRows([['Name'], ['A']]), /book columns/);
  assert.throws(() => parseRows([headers.map(h => h === 'Rank [B]' ? 'Rank [A]' : h), ['x']]), /same title/);
});
test('clear Condorcet winner and partial ballots tied below ranked books', () => {
  const result = rankedPairs(['A', 'B', 'C'], [[1, 2, 3], [1, 3, 2], [1, null, null]]);
  assert.equal(result.condorcetWinner, 0);
  assert.deepEqual(result.matrix, [[0, 3, 3], [0, 0, 1], [0, 1, 0]]);
  assert.deepEqual(result.tiers, [[0], [1, 2]]);
  assert.deepEqual(rankedPairs(['A', 'B'], []).tiers, []);
});
test('equal cyclic victories are rejected as a group, preserving a tie', () => {
  const result = rankedPairs(['A', 'B', 'C'], [[1, 2, 3], [3, 1, 2], [2, 3, 1]]);
  assert.deepEqual(result.tiers, [[0, 1, 2]]);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.locked.length, 0);
});
test('weaker cycle-closing edge is skipped', () => {
  const ballots = [...Array(3).fill([1, 2, 3]), ...Array(2).fill([3, 1, 2]), ...Array(2).fill([2, 3, 1])];
  const result = rankedPairs(['A', 'B', 'C'], ballots);
  assert.deepEqual(result.tiers, [[0], [1], [2]]);
  assert.equal(result.rounds.flat().filter(edge => !edge.accepted).length, 1);
});
test('tie preferences do not count for either side', () => {
  const result = rankedPairs(['A', 'B', 'C'], [[1, 1, 2]]);
  assert.deepEqual(result.tiers, [[0, 1], [2]]);
  assert.equal(result.matrix[0][1], 0);
});
test('margin ties use smaller opposition first', () => {
  const ballots = [[1, null, null], [2, 1, 3], [3, 1, 2], [1, 2, 3]];
  const result = rankedPairs(['A', 'B', 'C'], ballots);
  const edges = result.rounds.flat();
  for (let i = 1; i < edges.length; i++) {
    if (edges[i - 1].margin === edges[i].margin) assert.ok(edges[i - 1].opposition <= edges[i].opposition);
  }
});
test('row and candidate order cannot change named result', () => {
  const names = ['A', 'B', 'C', 'D'];
  let seed = 33;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 100; sample++) {
    const ballots = Array.from({ length: 11 }, () => names.map(() => next() < .2 ? null : Math.floor(next() * 4) + 1));
    const a = rankedPairs(names, ballots);
    const order = [2, 0, 3, 1], reordered = order.map(i => names[i]);
    const b = rankedPairs(reordered, [...ballots].reverse().map(ranks => order.map(i => ranks[i])));
    const mapped = (result, books) => result.tiers.map(tier => tier.map(i => books[i]).sort());
    assert.deepEqual(mapped(a, names), mapped(b, reordered));
  }
});
test('filters, organizer overrides, corrections and explicit exclusions', () => {
  const data = make([['One', 'Yes :)', '1', '2', '3'], ['Two', 'No :(', '1', '', '3'], ['Three', "I'm a brand new member!!", '', '1', '']]);
  assert.equal(selectBallots(data).included.length, 2);
  assert.equal(selectBallots(data).unresolved, 1);
  data.ballots[1].decision = 'include';
  assert.equal(selectBallots(data).included.length, 3);
  assert.equal(selectBallots(data, { attendance: ['attended', 'new'] }).included.length, 2);
  data.ballots[0].decision = 'exclude';
  assert.equal(selectBallots(data).included.length, 2);
  assert.equal(selectBallots(data, { attendance: [] }).included.length, 0);
});
test('duplicates require an explicit choice and can represent distinct people', () => {
  const data = make([[' Alex  Lee ', 'Yes', '1', '2', '3'], ['alex lee', 'No', '3', '2', '1']]);
  assert.equal(duplicateGroups(data).length, 1);
  assert.equal(selectBallots(data).included.length, 0);
  data.duplicateDecisions['alex lee'] = data.ballots[1].id;
  assert.equal(selectBallots(data).included[0].ballot.id, data.ballots[1].id);
  data.duplicateDecisions['alex lee'] = 'distinct';
  assert.equal(selectBallots(data).included.length, 2);
  assert.equal(compareMembers(data, data).both.length, 0, 'different people with the same name require manual linking');
});
test('name comparison is independent of ballot validity and supports link/unlink', () => {
  const current = make([['Alice Smith', 'Yes', '', '', ''], ['Robert', 'No', '1', '2', '3'], ['C', 'Yes', '2', '1', '3']]);
  const past = make([[' ALICE  SMITH ', 'Yes', '1', '2', '3'], ['Bob', 'No', '1', '2', '3'], ['D', 'Yes', '2', '1', '3']]);
  assert.equal(normalizeName(' ALICE  SMITH '), 'alice smith');
  const comparison = compareMembers(current, past, { robert: 'bob' });
  assert.equal(comparison.both.length, 2);
  assert.equal(comparison.currentOnly.length, 1);
  assert.equal(comparison.pastOnly.length, 1);
  assert.equal(selectBallots(current, { returningOnly: true, comparison }).included.length, 1);
  assert.equal(compareMembers(current, past, { 'alice smith': null }).both.length, 0);
});
