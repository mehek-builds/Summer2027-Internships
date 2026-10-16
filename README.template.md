# Summer 2027 Internships

**{{TOTAL}} internships observed at {{COMPANIES}} companies in the US, Canada and remote.** Updated {{UPDATED}}.

Roles come from employers' public job boards through [Litos](https://trylitos.com/?utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027). This is a dated observation of the feed. Employer availability can change after capture.

> **Dated snapshot.** Confirm each role on the employer's current posting before applying. The date above records the published snapshot, not a guarantee that every role is still available.

It covers every kind of internship, not only software: engineering, data, quant, product, design, business, finance and marketing.

Need a visa sponsor? [See internships at companies that sponsor visas](https://trylitos.com/jobs/internships/visa-sponsorship?utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027), where the posting offers sponsorship or the company has H-1B filings on record.

Looking outside North America, or for full-time roles? [Browse every open job on Litos](https://trylitos.com/browse-jobs?utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027).

Star this repo to keep it handy. An automated refresh is scheduled daily. The date above shows the last successful refresh.

## Contents

{{TOC}}

{{SECTIONS}}
## About this list

- **Where the roles come from:** employers' public applicant tracking system boards, read by the Litos job monitor. The daily scheduled workflow runs [`scripts/refresh.mjs`](scripts/refresh.mjs), which builds this page and its history from one captured feed generation.
- **What is included:** roles whose title says intern, internship or co-op, located in the US, Canada or remote, posted in the last 120 days.
- **Open data:** [`data/internship-lifespan.csv`](data/internship-lifespan.csv) records eligible internship observations from the Litos feed with the first and last day each was observed, and [`data/daily-totals.csv`](data/daily-totals.csv) records the feed's daily totals. List and history publish together only after the captured generation reconciles. [`data/export-generation.json`](data/export-generation.json) records its generation, capture time and counts; older daily-total rows predate this provenance metadata. The history renderer is [`scripts/snapshot.mjs`](scripts/snapshot.mjs). They record when this feed observed each posting, not confirmed employer opening or closing times. The legacy `internships_closed_since_last_run` column counts previously observed rows absent from a later feed pull; it does not independently confirm employer closure. A failed refresh keeps the previous published snapshot. Free to reuse under CC BY 4.0 with a link back to this repo.
- **Found a closed role or a mistake?** [Open an issue](../../issues) with the role and employer link for investigation.

Maintained by [Litos](https://trylitos.com/?utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027).
