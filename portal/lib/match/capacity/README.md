# Campaign capacity (Phase 4)

How many unique investor firms the sending inboxes can reach in a campaign, and how a target splits across one saved four-tier run. Planning only: it never changes a run, a match result, the engine switch or a list, and never pushes or sends anything.

| What | Where |
|---|---|
| Calculator for one client | `/admin/clients/[id]/match/capacity` (links on the Match page and the four-tier runs page) |
| Schedule (capacity) | `schedule.ts` |
| Allocation | `allocate.ts` |
| Plan = schedule + allocation | `plan.ts` |
| Saved plans | `supabase/match_capacity.sql`, `server.ts` |

Model version: `CAPACITY_MODEL_VERSION` in `schedule.ts`, saved with every plan.

## Capacity: a day-by-day schedule

- **Campaign length:** `round(months × 365.25 / 12)` calendar days. Day 0 is a Monday, and the first N days of each week are sending days.
- **Daily capacity:** inboxes × emails per inbox per day. During the warm-up weeks it is `floor(normal × warm-up % / 100)`.
- **Starting a firm:**
  - A firm starts on a sending day by emailing each of its contacts.
  - Follow-up k goes `delay` calendar days after the previous email, on the first sending day with room for all the firm's contacts.
  - Follow-ups are booked when the firm starts, so later initial emails only get what is left.
  - A firm starts only if every follow-up fits before the campaign ends.
  - As many firms start each day as fit.
- **Results:** sends available, initial emails, follow-up emails, contacts reached, unique firms, utilization, unused sends, and a week-by-week table.
- **Bottlenecks:**
  - Warm-up: sends lost against full capacity.
  - Follow-up timing: the days at the end that can't start new firms.
  - The inbox limit.
  - The plain-division figure, for comparison.
- **Backward from a target:** whether the inboxes reach it in time, and the fewest inboxes that would (binary search, other inputs unchanged).
- **Approximations:**
  - Months are average-length months.
  - Every week starts on a Monday, with no holidays.
  - Every send is assumed to go out. Bounces and replies are not modelled, and they don't free capacity.
  - A firm's contacts are emailed on the same day.
  - Firms are started as early as possible, so a real campaign that spreads its starts finishes the same number of firms or fewer.
- **Benchmarks** (1–6 months: 90 / 210 / 330 / 450 / 570 / 690) are references only. "On" means within 5%.
- **Default inputs:**
  - Contacts per firm = Primary + Backup (2), from the engine's outreach sequence.
  - Follow-ups = 2, from the Email Copy sequence.
  - The sending infrastructure isn't stored anywhere in the app, so these are an example: 1 inbox, 35 a day, 1 warm-up week at 50%, Monday to Friday, 7 days between emails. They land within about 6% of each benchmark.

## Allocation

The source is one complete saved four-tier run.

- **Eligible:** in a tier or a generalist; not rejected for the client; not shown through another record; each FirmID once. Excluded, unresolved and near-miss firms never enter.
- **Order:**
  1. Core, capped at 10.
  2. Sphere, Tier 3 and Tier 4, each in full before the next. No fixed ratio.
  3. Generalists, only for the shortfall and only when an admin ticks the approval. They stay labelled "Generalists (top-up)".
- Within a source, firms keep the run's saved order.
- **Shown:** available, planned and remaining per source; the shortfall; and the most firms the run can supply (Core up to the cap, the other tiers in full, and every generalist).

## Saved plans

- `match_capacity_plans` stores one row per version per client. A plan records:
  - the run id;
  - the profile version, taxonomy revision, rules version and Fund Database version, copied from the run by the database;
  - the model version;
  - the inputs, the target and the generalist approval;
  - the capacity, and the allocation with every planned firm.
- Saved only through `match_save_capacity_plan`. Triggers reject every update, delete and truncate, and the app's role can only read.
- The server rebuilds the plan from the run's stored rows, never from the browser.
- The page rebuilds saved plans of the run shown and says whether they are identical.
