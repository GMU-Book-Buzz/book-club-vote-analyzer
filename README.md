# Book Buzz · Book of the Month vote analyzer

A free, static website for a nontechnical club organizer. ZIP extraction, CSV parsing, ballot review, Ranked Pairs voting, and past-month comparison all run on the organizer's device. No login, backend, paid API, analytics, or server upload is required.

**Website:** https://gmu-book-buzz.github.io/book-club-vote-analyzer/

## Monthly use

1. Export the Google Forms response sheet as CSV (or a ZIP containing that CSV), retaining its headers.
2. Open the website and choose the current-month file.
3. Review flagged ballots. Valid partial rankings start at 1 and contain no repeated or skipped ranks. Unranked books are tied last.
4. Include, exclude, or correct flagged ballots. Including a gap preserves its order; including repeated ranks counts those books as tied. Unreadable ranks must be corrected. Changes affect only this browser session.
5. Select any combination of meeting-attendance groups; all groups start selected. Unknown/missing answers have a separate category.
6. Optionally add a past-month file. Only member names are required: attendance, book columns, and ranking format may differ or be absent. If the name column cannot be identified uniquely, choose it from the column picker. Review names, link spelling variants, and optionally count only returning voters. Prior book rankings never affect the current election.
7. Use the attendance × voting-history checkbox grid to include any combination (for example, exclude only non-attendees who voted both months). Every ballot is displayed with a live checked/unchecked state and its features. Manual ballot checkboxes override filters, but cannot bypass missing names, unreadable ranks, or unresolved duplicates. “Follow filters” clears manual selections while retaining accepted rank overrides and corrections.
8. Record the result using your browser's Print / Save as PDF. Refreshing or leaving clears all files, corrections, overrides, and links. Keep original exports privately.

If duplicate names appear, select one submission or confirm they are different people. Different people with identical names require manual cross-month links. Comparison measures submission presence, not ballot validity. Missing names cannot be matched; correct the source CSV when a past-month name is missing.

## Rules and file format

- Original Google Forms headers: `Timestamp` (optional), `What is your full name?`, an attendance question containing `attended` and `meeting` or `event`, and book headers ending with `[Book title]`.
- 2–30 distinct book columns; titles are detected anew each month. The supplied format uses seven books.
- Ranks can be plain integers or labels such as `1 (Most Preferred)` and `7 (Least Preferred)`. Blank cells are unranked.
- Attendance answers beginning `Yes` and `No` map to their categories; answers containing `new` map to new members. Other values are shown as unknown.
- Attendance columns are optional, including for the main month. If absent, all responses have unknown attendance and are included by default. New main-month imports reset the ballot list to show every response. Each ballot's expanded choices show whether its name matched the comparison month.
- UTF-8 CSV, up to 10 MB input, 20 MB expanded ZIP, 100 archive entries, and 10,000 nonempty responses. Multiple CSVs trigger a selection control. Files that cannot be parsed within 15 seconds are rejected without freezing the page.
- Every ballot has equal weight. Ranked Pairs Margin sorts strict victories by margin descending and opposition ascending. Equal-strength victories are processed together; new cycle-participating edges are rejected. Previously locked edges remain. Repeatedly removing nodes without incoming edges produces tied ranking tiers. No arbitrary alphabetical tie-break is used.
- Provisional means eligible ballots or returning-voter duplicate identities still need review. Explicitly excluded ballots are resolved decisions. With zero eligible ballots there is no result.

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

In repository **Settings → Pages**, select **GitHub Actions** as the source. Each push to `main` runs unit tests, builds the site, runs browser tests, and publishes only on success. Pull requests run checks without deployment. The deployed artifact contains the application only, never uploaded data.

If deployment fails, open the latest run in **Actions → Test and publish Book Buzz** and read the failed step. Check that Pages is enabled with Actions as its source. Correct the issue and push a fix or rerun the workflow. To restore an earlier version, revert the bad commit and push; the same checks redeploy it. A failed test prevents deployment and leaves the previous live version in place.

Dependencies are pinned in package-lock.json. Update them through a reviewed change and run both test suites. Third-party licenses are in THIRD_PARTY_NOTICES.md.
