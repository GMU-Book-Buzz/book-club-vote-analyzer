# Book Buzz · Book of the Month vote analyzer

A free, static website for a nontechnical club organizer. ZIP extraction, CSV parsing, ballot review, Ranked Pairs voting, and automatic semester-history checks all run on the organizer's device. No login, backend, paid API, analytics, or server upload is required.

**Website:** https://gmu-book-buzz.github.io/book-club-vote-analyzer/

## Monthly use

1. Export the Google Forms response sheet as CSV (or a ZIP containing that CSV), retaining its headers.
2. Open the website and choose the current-month file.
3. Review flagged ballots. Valid partial rankings start at 1 and contain no repeated or skipped ranks. Unranked books are tied last.
4. Include, exclude, or correct flagged ballots. Including a gap preserves its order; including repeated ranks counts those books as tied. Unreadable ranks must be corrected. Changes affect only this browser session.
5. Select any combination of meeting-attendance groups; all groups start selected. Unknown/missing answers have a separate category.
6. Semester history loads automatically. All saved September and October 2026 voters are checked for each upload. No past-month upload is needed. A prior name match prevents a ballot from being classified as a new member. If their answer claims new membership, the app flags the conflict and places them in “Returning member — attendance unconfirmed.” Attendance is not inferred from having voted.
7. Use the attendance × voting-history checkbox grid to include any combination (for example, exclude only non-attendees who previously voted this semester). Every ballot is displayed with a live checked/unchecked state and its features. Manual ballot checkboxes override filters, but cannot bypass missing names, unreadable ranks, or unresolved duplicates. “Follow filters” clears manual selections while retaining accepted rank overrides and corrections.
8. Record the result using your browser's Print / Save as PDF. Refreshing or leaving clears the current file, corrections, overrides, and history decisions; built-in history remains available. Keep original exports privately.

If duplicate names appear, select one submission or confirm they are different people. History matches case-normalized names with collapsed whitespace. Spelling differences and identical names can produce missed or false matches. Correct a current name or use the History match review selector within View choices to confirm returning status or no earlier vote for that session. No earlier match is not proof of new membership. Missing names cannot be matched.

## Built-in history and maintenance

`src/semester-history.js` contains Fall 2026 comparison fingerprints for September (27 names) and October (33 names), generated from the organizer-provided exports. It includes no raw names, rankings, attendance answers, or timestamps. Each fingerprint is SHA-256 over a versioned prefix, the election month, and the normalized name. The public fingerprints are not strong anonymization: someone who guesses a name can test it. Keep original CSVs and ZIPs private.

Every month in the saved history list is checked automatically; no election-month selector is needed. The coverage card shows which months are loaded. If the list is empty, new-member claims remain unverified. Current uploads do not change the built-in history.

To regenerate the Fall 2026 lookup, use the maintainer-only CLI, supplying all months to retain:

```sh
node scripts/import-history.js 2026-09 /private/september.zip 2026-10 /private/october.zip
```

To extend the list, regenerate it with every archive to retain, including the latest final-results archive. History management by the president through the website is a future feature. For a new semester, update the generator's semester label and validation range and deliberately choose which archives to retain. Review and run both test suites before pushing. The CLI saves only fingerprints; never commit the source archives.


## Rules and file format

- Original Google Forms headers: `Timestamp` (optional), `What is your full name?`, an attendance question containing `attended` and `meeting` or `event`, and book headers ending with `[Book title]`.
- 2–30 distinct book columns; titles are detected anew each month. The supplied format uses seven books.
- Ranks can be plain integers or labels such as `1 (Most Preferred)` and `7 (Least Preferred)`. Blank cells are unranked.
- Attendance answers beginning `Yes` and `No` map to their categories; answers containing `new` map to new members. Other values are shown as unknown.
- Attendance columns are optional, including for the main month. If absent, all responses have unknown attendance and are included by default. New main-month imports reset the ballot list to show every response. Each ballot's expanded choices show its automatic semester matches, applicable month labels, and any new-member conflict.
- UTF-8 CSV, up to 10 MB input, 20 MB expanded ZIP, 100 archive entries, and 10,000 nonempty responses. Multiple CSVs trigger a selection control. Files that cannot be parsed within 15 seconds are rejected without freezing the page.
- Every ballot has equal weight. Ranked Pairs Margin sorts strict victories by margin descending and opposition ascending. Equal-strength victories are processed together; new cycle-participating edges are rejected. Previously locked edges remain. Repeatedly removing nodes without incoming edges produces tied ranking tiers. No arbitrary alphabetical tie-break is used.
- Provisional means eligible ballots still need review. Explicitly excluded ballots are resolved decisions. With zero eligible ballots there is no result.

## Passing the site to the next organizer

Monthly operators only need the website bookmark and response exports. They do not need a GitHub account. Give them the on-page monthly guide and keep member data out of the public repository.

For maintenance, keep the repository in the GMU-Book-Buzz organization and have a club owner grant the next maintainer appropriate repository access through GitHub. Maintain more than one trusted organization owner, and remove departing access through the club's usual process. No credentials belong in the code or this document.

## Development

Install Node.js 24 or later. Run:

```sh
npm ci
npm test
npm run build
npm start
```

Open http://127.0.0.1:4173/book-club-vote-analyzer/. For browser tests:

```sh
npx playwright install chromium
npm run test:browser
```

The `src/` modules separate voting/validation/matching from the UI. `public/` contains static layout and the file-reader worker. `scripts/build.js` copies the application and pinned dependencies into `dist/`; no CDN is used. Tests contain synthetic member names only. Do not commit the real sample ZIP/CSV.

## Free hosting and deployment

Keep this repository **public**, use the included `github.io` address, and use only standard GitHub-hosted Actions runners. GitHub Pages supports public repositories on GitHub Free, including organizations. There is no continuously running server or paid service to maintain. GitHub service limits and availability policies still apply; no provider guarantees perpetual free pricing or uninterrupted uptime.

In repository **Settings → Pages**, select **GitHub Actions** as the source. Each push to `main` runs unit tests, builds the site, runs browser tests, and publishes only on success. Pull requests run checks without deployment. The deployed artifact contains the application and its minimal built-in history index. Current uploaded data stays on the device.

If deployment fails, open the latest run in **Actions → Test and publish Book Buzz** and read the failed step. Check that Pages is enabled with Actions as its source. Correct the issue and push a fix or rerun the workflow. To restore an earlier version, revert the bad commit and push; the same checks redeploy it. A failed test prevents deployment and leaves the previous live version in place.

Dependencies are pinned in package-lock.json. Update them through a reviewed change and run both test suites. Third-party licenses are in THIRD_PARTY_NOTICES.md.
