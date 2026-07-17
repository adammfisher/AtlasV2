/**
 * Design-quality eval (Deliverable F): 18 fixed office specs → build → score
 * with the deterministic design gates, BEFORE (pre-doctrine builders from git)
 * vs AFTER (working tree). Specs are deterministic — this evaluates the design
 * pipeline (schemas, builders, gates), not model generation, so it runs without
 * any model. `npm run test:design`.
 *
 * BEFORE runs extract the builders from the commit preceding "A: design
 * doctrine in SKILLs" and feed them the same content downgraded to the old
 * schema vocabulary. Both eras' FILES are scored by scripts/test/design_score.py
 * (the current gates) — the before column is the baseline the doctrine beats.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const py = path.join(repoRoot, 'runtimes/python/venv/bin/python');
const outRoot = path.join(repoRoot, '.eval-design');

type Kind = 'pptx' | 'docx' | 'xlsx' | 'pdf';
interface Eval {
  id: string;
  kind: Kind;
  prompt: string;
  spec: Record<string, unknown>;
}

const notes = (s: string) => s;

// ── the 18 eval prompts and their doctrine-correct specs ────────────────────
const EVALS: Eval[] = [
  {
    id: '01-q3-revenue-review',
    kind: 'pptx',
    prompt: 'Q3 SaaS revenue review deck (title, agenda, 3 content_chart slides, big_stat, closing_cta)',
    spec: {
      title: 'Q3 revenue grew 34% on enterprise expansion',
      slides: [
        { archetype: 'title', title: 'Q3 revenue grew 34% on enterprise expansion', subtitle: 'Revenue review · October 2026', speaker_notes: notes('Open on the headline number; the deck explains the three drivers.') },
        { archetype: 'agenda', title: 'Three drivers, one risk, two asks', bullets: ['Enterprise expansion', 'Usage-based pricing', 'Churn reduction', 'The capacity risk', 'Asks for Q4'], speaker_notes: notes('Forty minutes; decisions needed on the two asks.') },
        { archetype: 'content_chart', title: 'Enterprise ARR doubled while SMB held flat', chart: { kind: 'bar', categories: ["Q4'25", "Q1'26", "Q2'26", "Q3'26"], series: [{ name: 'Enterprise $M', values: [4.1, 5.0, 6.4, 8.2] }, { name: 'SMB $M', values: [3.2, 3.3, 3.2, 3.4] }], sort: 'time' }, bullets: ['Enterprise up 100% YoY', 'SMB flat by design'], speaker_notes: notes('Two series, one message: the enterprise bet pays.') },
        { archetype: 'content_chart', title: 'Usage pricing lifted expansion revenue every month', chart: { kind: 'line', categories: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'], series: [{ name: 'Expansion $K', values: [180, 220, 275, 310, 355, 410] }], sort: 'time' }, speaker_notes: notes('Steady slope since the Q1 pricing change; no discounting behind it.') },
        { archetype: 'content_chart', title: 'Churn fell in every segment, led by mid-market', chart: { kind: 'bar', categories: ['Mid-market', 'SMB', 'Enterprise'], series: [{ name: 'Churn delta pts', values: [1.8, 1.1, 0.4] }], sort: 'value_desc' }, speaker_notes: notes('Mid-market drove the win — the onboarding rework hit hardest there.') },
        { archetype: 'big_stat', title: 'Net revenue retention set a company record', stat: { value: '134%', label: 'Net revenue retention, Q3 2026' }, support: 'Up nine points since usage-based pricing shipped.', speaker_notes: notes('The one number to remember from this deck.') },
        { archetype: 'closing_cta', title: 'Fund the capacity plan and Q4 compounds the gains', subtitle: 'Decisions by Friday · revenue@axiom.dev', speaker_notes: notes('End on the ask: two hires and the infra budget.') },
      ],
    },
  },
  {
    id: '02-series-a-pitch',
    kind: 'pptx',
    prompt: 'Series A pitch: problem/solution/market/traction/ask — one idea per slide',
    spec: {
      title: 'Compliance reporting is broken — we make it push-button',
      slides: [
        { archetype: 'title', title: 'Compliance reporting is broken — we make it push-button', subtitle: 'Series A · Axiom Compliance · 2026', speaker_notes: notes('One sentence: what we do and why now.') },
        { archetype: 'content_bullets', title: 'Mid-market firms burn a quarter per audit cycle', bullets: ['Audits take 11 weeks of manual evidence pulls', 'Compliance teams average 1.5 people', 'Fines rose 40% since 2024'], icons: ['time', 'people', 'risk'], speaker_notes: notes('The problem is labor, not knowledge — evidence collection is copy-paste work.') },
        { archetype: 'content_bullets', title: 'We automate evidence collection end to end', bullets: ['Connectors pull evidence from 40 systems', 'Controls map once, reuse every audit', 'Auditor portal cuts review cycles 60%'], icons: ['gear', 'check', 'growth'], speaker_notes: notes('Demo available; the connector library is the moat.') },
        { archetype: 'big_stat', title: 'The wedge market alone is a billion-dollar problem', stat: { value: '$1.4B', label: 'US mid-market compliance tooling spend, 2026' }, support: 'Growing 18% annually as frameworks multiply.', speaker_notes: notes('Bottom-up from 34K firms × observed ACV; sources in appendix.') },
        { archetype: 'content_chart', title: 'Revenue tripled in twelve months on zero paid acquisition', chart: { kind: 'line', categories: ['Q4', 'Q1', 'Q2', 'Q3'], series: [{ name: 'ARR $K', values: [240, 380, 520, 710] }], sort: 'time' }, speaker_notes: notes('All inbound and partner-led; sales team is two people.') },
        { archetype: 'closing_cta', title: 'Raising $8M to own the auditor channel', subtitle: 'adam@axiomcompliance.dev', speaker_notes: notes('Use of funds: 60% GTM, 30% connectors, 10% ops.') },
      ],
    },
  },
  {
    id: '03-product-launch',
    kind: 'pptx',
    prompt: 'Product launch plan with a 5-step timeline_process',
    spec: {
      title: 'Axiom Flows launches October 20 in five gated phases',
      slides: [
        { archetype: 'title', title: 'Axiom Flows launches October 20 in five gated phases', subtitle: 'Launch plan · GTM team', speaker_notes: notes('Every phase has an exit gate; dates hold only if gates pass.') },
        { archetype: 'timeline_process', title: 'Five phases from beta to general availability', steps: [{ label: 'Private beta', detail: '30 accounts, Aug 18' }, { label: 'Beta expansion', detail: '150 accounts, Sep 8' }, { label: 'Pricing lock', detail: 'Sep 22' }, { label: 'Public launch', detail: 'Oct 20' }, { label: 'GA + SLA', detail: 'Nov 10' }], speaker_notes: notes('Gates: NPS 45 at each expansion, error budget intact.') },
        { archetype: 'content_bullets', title: 'Launch week concentrates on three channels', bullets: ['Founder webinar with 2,000 registrants target', 'Partner co-announcements with 5 integrators', 'Lifecycle email to 18K trial signups'], speaker_notes: notes('No paid spend at launch; paid starts week three if organic converts.') },
        { archetype: 'closing_cta', title: 'Gate reviews every Monday — first one August 25', subtitle: 'launch@axiom.dev', speaker_notes: notes('Standing 30-minute gate review; owners on the invite.') },
      ],
    },
  },
  {
    id: '04-competitive-comparison',
    kind: 'pptx',
    prompt: 'Competitive comparison: us vs two competitors — comparison archetype',
    spec: {
      title: 'We win on time-to-value; they win on suite breadth',
      slides: [
        { archetype: 'title', title: 'We win on time-to-value; they win on suite breadth', subtitle: 'Competitive review · Q3 2026', speaker_notes: notes('Honest framing: where we win and where we lose deals today.') },
        { archetype: 'comparison', title: 'Setup time is our wedge in every evaluated deal', columns: [{ head: 'Axiom', items: ['3-day setup', '$29 per seat', 'API-first'] }, { head: 'CompetitorA', items: ['6-week setup', '$45 per seat', 'Suite bundle'] }, { head: 'CompetitorB', items: ['4-week setup', '$38 per seat', 'Services-led'] }], speaker_notes: notes('Same three rows per column; setup time decides evals under 500 seats.') },
        { archetype: 'table', title: 'Win rates hold above 60% wherever setup time matters', table: { headers: ['Segment', 'Win rate', 'Deals', 'Trend'], rows: [['SMB', '71%', '48', 'up'], ['Mid-market', '63%', '31', 'up'], ['Enterprise', '38%', '12', 'flat']] }, speaker_notes: notes('Enterprise losses are suite-breadth losses — roadmap answer, not GTM.') },
        { archetype: 'closing_cta', title: 'Double down where setup time decides the deal', subtitle: 'competitive@axiom.dev', speaker_notes: notes('Asks: SMB/mid-market focus, enterprise patience.') },
      ],
    },
  },
  {
    id: '05-case-study',
    kind: 'pptx',
    prompt: 'Customer case study: challenge → approach → result with a big_stat',
    spec: {
      title: 'Corewell cut close time from 12 days to 3',
      slides: [
        { archetype: 'title', title: 'Corewell cut close time from 12 days to 3', subtitle: 'Customer case study · retail · 4,000 employees', speaker_notes: notes('At-risk account turned reference customer in two quarters.') },
        { archetype: 'content_bullets', title: 'Manual consolidation blocked every month-end close', bullets: ['40 store ledgers merged by hand', '12-day close, 3 people full-time', 'Errors found after the close, not during'], icons: ['risk', 'time', 'people'], speaker_notes: notes('The challenge in their words: close was a fire drill every month.') },
        { archetype: 'timeline_process', title: 'A three-phase rollout kept stores selling throughout', steps: [{ label: 'Pilot', detail: '4 stores, two weeks' }, { label: 'Wave rollout', detail: '36 stores over a weekend' }, { label: 'Automation', detail: 'Close checklist automated' }], speaker_notes: notes('The weekend migration is the story customers repeat.') },
        { archetype: 'big_stat', title: 'The close now takes a quarter of the time', stat: { value: '3 days', label: 'Month-end close, down from 12' }, support: 'Zero post-close corrections in the last five months.', speaker_notes: notes('Time saved went to analysis, not headcount cuts.') },
        { archetype: 'quote', title: '', quote: 'We migrated 40 stores in a weekend and nobody noticed. That never happens.', attribution: 'Dana Whitfield, VP Operations, Corewell Retail', speaker_notes: notes('Direct quote from the QBR; approved for external use.') },
        { archetype: 'closing_cta', title: 'Three more retail rollouts start this quarter', subtitle: 'references@axiom.dev', speaker_notes: notes('Corewell hosts a reference call monthly; book via the alias.') },
      ],
    },
  },
  {
    id: '06-post-mortem',
    kind: 'pptx',
    prompt: 'Engineering post-mortem: incident timeline + metrics chart',
    spec: {
      title: 'The March 12 outage: 41 minutes, one bad config push',
      slides: [
        { archetype: 'title', title: 'The March 12 outage: 41 minutes, one bad config push', subtitle: 'Post-mortem · blameless · SEV-1', speaker_notes: notes('Blameless review; the system let a bad config through, not a person.') },
        { archetype: 'timeline_process', title: 'Detection was fast; rollback path was not', steps: [{ label: 'Config push', detail: '14:02, all regions' }, { label: 'Alerts fire', detail: '14:05, error rate 40%' }, { label: 'Root cause found', detail: '14:19' }, { label: 'Rollback done', detail: '14:43, manual' }], speaker_notes: notes('17 minutes finding it, 24 minutes rolling back — rollback is the fix target.') },
        { archetype: 'content_chart', title: 'Error rate recovered in full within the hour', chart: { kind: 'line', categories: ['14:00', '14:10', '14:20', '14:30', '14:40', '15:00'], series: [{ name: 'Error %', values: [0.1, 38, 41, 35, 12, 0.2] }], sort: 'time' }, speaker_notes: notes('No data loss; retries absorbed the write path.') },
        { archetype: 'content_bullets', title: 'Three fixes remove this failure class entirely', bullets: ['Config pushes canary one region first', 'One-click rollback shipped last sprint', 'Config linting blocks the bad shape'], icons: ['check', 'gear', 'risk'], speaker_notes: notes('Two of three fixes already merged; canary lands next week.') },
        { archetype: 'closing_cta', title: 'Fix owners report at the April reliability review', subtitle: 'sre@axiom.dev', speaker_notes: notes('Action items tracked in the reliability board, not this deck.') },
      ],
    },
  },
  {
    id: '07-board-kpis',
    kind: 'pptx',
    prompt: 'Board update with a KPI dashboard table (≤ 7 columns)',
    spec: {
      title: 'Every core KPI beat plan in Q3',
      slides: [
        { archetype: 'title', title: 'Every core KPI beat plan in Q3', subtitle: 'Board update · October 2026', speaker_notes: notes('One table, one stat, one ask — short board deck by design.') },
        { archetype: 'table', title: 'Five KPIs, all green against the operating plan', table: { headers: ['Metric', 'Plan', 'Actual', 'Delta'], rows: [['ARR $M', '11.2', '12.1', '+0.9'], ['NRR %', '128', '134', '+6'], ['Burn $M', '1.9', '1.7', '-0.2'], ['Churn %', '2.8', '2.1', '-0.7'], ['Headcount', '96', '94', '-2']] }, speaker_notes: notes('Deltas all favorable; burn under plan while beating revenue.') },
        { archetype: 'big_stat', title: 'Runway extends past the next raise window', stat: { value: '31 mo', label: 'Runway at current burn, October 2026' }, support: 'Raise timing is now a choice, not a deadline.', speaker_notes: notes('The strategic consequence of the KPI table.') },
        { archetype: 'closing_cta', title: 'Approve the Q4 hiring plan as circulated', subtitle: 'board@axiom.dev', speaker_notes: notes('Plan pre-read went out Monday; vote today.') },
      ],
    },
  },
  {
    id: '08-marketing-funnel',
    kind: 'pptx',
    prompt: 'Marketing funnel breakdown: chart + parallel bullets',
    spec: {
      title: 'The funnel leaks at trial activation, not acquisition',
      slides: [
        { archetype: 'title', title: 'The funnel leaks at trial activation, not acquisition', subtitle: 'Funnel review · September 2026', speaker_notes: notes('Spend more on activation, not on top-of-funnel.') },
        { archetype: 'content_chart', title: 'Activation drops harder than any other stage', chart: { kind: 'bar', categories: ['Visit→Signup', 'Signup→Trial', 'Trial→Active', 'Active→Paid'], series: [{ name: 'Conversion %', values: [3.1, 61, 24, 48] }], sort: 'given' }, bullets: ['Trial→Active is the outlier', 'Benchmark for our tier is 40%'], speaker_notes: notes('Stage order preserved deliberately — the funnel reads left to right.') },
        { archetype: 'content_bullets', title: 'Three activation fixes ship this quarter', bullets: ['Guided first-run replaces the empty state', 'Sample data loads on signup', 'Day-two email shows the aha metric'], icons: ['idea', 'gear', 'growth'], speaker_notes: notes('Each fix targets the day-one drop the cohort data shows.') },
        { archetype: 'closing_cta', title: 'Re-measure the funnel at the November review', subtitle: 'growth@axiom.dev', speaker_notes: notes('Success = Trial→Active at 35% by November.') },
      ],
    },
  },
  {
    id: '09-all-hands',
    kind: 'pptx',
    prompt: 'All-hands strategy deck using section_dividers and a quote slide',
    spec: {
      title: 'One priority for 2027: win the mid-market',
      slides: [
        { archetype: 'title', title: 'One priority for 2027: win the mid-market', subtitle: 'All-hands · November 2026', speaker_notes: notes('Single-priority year; everything else is in service of it.') },
        { archetype: 'section_divider', title: 'Where we are', speaker_notes: notes('Part one: the honest picture.') },
        { archetype: 'content_bullets', title: 'We lead SMB but stall above 500 seats', bullets: ['SMB win rate 71%, share growing', 'Mid-market win rate 63% and rising', 'Enterprise deals stall on suite gaps'], speaker_notes: notes('The stall is roadmap, not sales execution.') },
        { archetype: 'section_divider', title: 'Where we go', speaker_notes: notes('Part two: the plan.') },
        { archetype: 'quote', title: '', quote: 'The companies that win the mid-market win the decade.', attribution: 'Priya Sharma, CEO', speaker_notes: notes('Priya lands the why before the roadmap slide.') },
        { archetype: 'content_bullets', title: 'Three bets take us up-market in 2027', bullets: ['SSO and audit logs ship in Q1', 'Partner-led onboarding for 500+ seats', 'Pricing tier built for ops teams'], icons: ['check', 'people', 'money'], speaker_notes: notes('Each bet has an owner and a quarterly gate.') },
        { archetype: 'closing_cta', title: 'Team OKRs land next week — align yours to the bet', subtitle: 'strategy@axiom.dev', speaker_notes: notes('Managers cascade OKRs by Friday next.') },
      ],
    },
  },
  {
    id: '10-research-summary',
    kind: 'pptx',
    prompt: 'Data-heavy research summary: assertion-evidence style, a chart per content slide',
    spec: {
      title: 'Latency, not features, drives churn in year one',
      slides: [
        { archetype: 'title', title: 'Latency, not features, drives churn in year one', subtitle: 'Research summary · 214 churned accounts analyzed', speaker_notes: notes('Assertion-evidence: every claim gets one chart.') },
        { archetype: 'content_chart', title: 'Churned accounts saw double the p95 latency', chart: { kind: 'bar', categories: ['Retained', 'Churned'], series: [{ name: 'p95 ms', values: [240, 510] }], sort: 'given' }, speaker_notes: notes('Controlled for plan size and region; the gap holds.') },
        { archetype: 'content_chart', title: 'Feature usage barely separates the two cohorts', chart: { kind: 'bar', categories: ['Retained', 'Churned'], series: [{ name: 'Features used', values: [7.2, 6.8] }], sort: 'given' }, speaker_notes: notes('The feature-gap hypothesis dies here.') },
        { archetype: 'content_chart', title: 'Churn risk rises sharply past 400ms p95', chart: { kind: 'line', categories: ['<200', '200-300', '300-400', '400-500', '>500'], series: [{ name: 'Churn %', values: [1.1, 1.4, 2.2, 4.8, 7.9] }], sort: 'given' }, speaker_notes: notes('The knee at 400ms sets the SLO target.') },
        { archetype: 'big_stat', title: 'The fix has a measurable ceiling', stat: { value: '-38%', label: 'Modeled year-one churn if p95 < 300ms' }, support: 'Latency program business case follows from this number.', speaker_notes: notes('Model assumptions documented in the appendix.') },
        { archetype: 'closing_cta', title: 'Fund the latency SLO program for Q1', subtitle: 'research@axiom.dev', speaker_notes: notes('The ask ties directly to the modeled ceiling.') },
      ],
    },
  },
  {
    id: '11-investor-teaser',
    kind: 'pptx',
    prompt: 'One-metric investor teaser: big_stat + quote',
    spec: {
      title: 'Axiom: the retention engine for B2B SaaS',
      slides: [
        { archetype: 'title', title: 'Axiom: the retention engine for B2B SaaS', subtitle: 'Investor teaser · 2026', speaker_notes: notes('Two slides of substance by design — teaser, not deck.') },
        { archetype: 'big_stat', title: 'Customers keep more revenue every quarter', stat: { value: '134%', label: 'Median customer NRR after 12 months on Axiom' }, support: 'Across 212 production customers; cohort table on request.', speaker_notes: notes('The single number the fund remembers.') },
        { archetype: 'quote', title: '', quote: 'Axiom paid for itself before the first renewal cycle closed.', attribution: 'CFO, mid-market logistics customer', speaker_notes: notes('Attribution anonymized at customer request; verifiable in diligence.') },
        { archetype: 'closing_cta', title: 'Data room opens November 1', subtitle: 'raise@axiom.dev', speaker_notes: notes('Meetings the week of Nov 4.') },
      ],
    },
  },
  {
    id: '12-two-column-feature',
    kind: 'pptx',
    prompt: 'Two-column feature overview: text + screenshot',
    spec: {
      title: 'Self-serve migration removes the biggest onboarding queue',
      slides: [
        { archetype: 'title', title: 'Self-serve migration removes the biggest onboarding queue', subtitle: 'Feature overview · Axiom Migrate', speaker_notes: notes('The feature that unblocked the SMB motion.') },
        { archetype: 'two_column', title: 'Customers migrate without filing a ticket', bullets: ['Average migration runs 41 minutes', 'Rollback is one click for 30 days', 'Support tickets from migration fell 82%'], stat: { value: '87%', label: 'Migrations completed fully self-serve' }, speaker_notes: notes('Right panel is the proof; bullets say what changed.') },
        { archetype: 'content_bullets', title: 'Three guardrails make self-serve safe', bullets: ['Dry-run validates every record first', 'Conflicts queue for review, never overwrite', 'Full audit log ships with every run'], icons: ['check', 'risk', 'gear'], speaker_notes: notes('Safety story matters as much as speed for ops buyers.') },
        { archetype: 'closing_cta', title: 'Migrate goes default-on for new signups Nov 1', subtitle: 'product@axiom.dev', speaker_notes: notes('Rollout flag flips per cohort; support briefed.') },
      ],
    },
  },
  {
    id: '13-okr-review',
    kind: 'pptx',
    prompt: 'Quarterly OKR review: agenda + comparison + closing_cta',
    spec: {
      title: 'Two of three company OKRs landed green in Q3',
      slides: [
        { archetype: 'title', title: 'Two of three company OKRs landed green in Q3', subtitle: 'OKR review · October 2026', speaker_notes: notes('Green, green, red — and what the red teaches us.') },
        { archetype: 'agenda', title: 'Scorecard first, then the red OKR in depth', bullets: ['Q3 scorecard', 'Revenue OKR', 'Reliability OKR', 'Hiring OKR (red)', 'Q4 targets'], speaker_notes: notes('Most time on the red one; greens get a slide each.') },
        { archetype: 'comparison', title: 'Target versus actual across the three OKRs', columns: [{ head: 'Revenue', items: ['Target: $11.2M ARR', 'Actual: $12.1M', 'Status: green'] }, { head: 'Reliability', items: ['Target: 99.95%', 'Actual: 99.97%', 'Status: green'] }, { head: 'Hiring', items: ['Target: 12 hires', 'Actual: 7 hires', 'Status: red'] }], speaker_notes: notes('Parallel rows: target, actual, status — read down each column.') },
        { archetype: 'content_bullets', title: 'The hiring miss traces to one bottleneck', bullets: ['Offer-accept rate held at 81%', 'Onsite capacity capped at 9 per week', 'Sourcing pipeline grew 3x in September'], speaker_notes: notes('Fix is interviewer capacity, not brand or comp.') },
        { archetype: 'closing_cta', title: 'Q4 targets lock Friday — flag conflicts now', subtitle: 'okrs@axiom.dev', speaker_notes: notes('Same three OKR families roll forward with new numbers.') },
      ],
    },
  },
  {
    id: '14-project-report',
    kind: 'docx',
    prompt: 'DOCX: 6-page project report (headings, TOC, a table, a figure)',
    spec: {
      metadata: { title: 'Axiom Data Platform Migration — Final Report', author: 'Platform Team' },
      blocks: [
        { kind: 'heading', level: 1, text: 'Executive summary' },
        { kind: 'paragraph', text: 'The data platform migration completed on June 30, two weeks ahead of schedule and 12% under budget. All four regional pipelines now run on the consolidated platform, processing cost fell 38%, and data freshness improved from daily to hourly in every region. This report records the approach, the measured outcomes, the incidents encountered, and the follow-on work we recommend for the fourth quarter.' },
        { kind: 'heading', level: 1, text: 'Background and goals' },
        { kind: 'paragraph', text: 'Four regional data pipelines grew independently between 2022 and 2025, each with its own scheduler, storage layout, and on-call rotation. Duplicate ingestion of shared sources cost roughly $41K per month, and cross-region reporting required manual reconciliation that consumed two analyst-days per week.' },
        { kind: 'paragraph', text: 'The migration set three goals: consolidate the four pipelines onto one governed platform, cut processing cost by at least 30%, and improve data freshness to hourly without increasing the on-call burden.' },
        { kind: 'heading', level: 2, text: 'Scope and constraints' },
        { kind: 'paragraph', text: 'Scope covered ingestion, transformation, and serving for 214 datasets across the four regions. Consumer-facing APIs were explicitly out of scope. The hard constraint was zero downtime for the 31 datasets feeding customer-visible dashboards, which forced the wave-based cutover design described below.' },
        { kind: 'heading', level: 1, text: 'Approach' },
        { kind: 'paragraph', text: 'We migrated in four waves ordered by blast radius, starting with internal-only datasets and ending with the customer-visible tier. Each wave ran the old and new pipelines in parallel for one week with automated output diffing before the cutover, and every wave had a one-command rollback path that we exercised in rehearsal.' },
        { kind: 'heading', level: 2, text: 'Wave structure' },
        { kind: 'numbered_list', items: ['Wave 1: 62 internal datasets, two-week parallel run', 'Wave 2: 88 analyst datasets, one-week parallel run', 'Wave 3: 33 partner-facing datasets, one-week parallel run', 'Wave 4: 31 customer-visible datasets, staged over two weekends'] },
        { kind: 'heading', level: 2, text: 'Verification' },
        { kind: 'paragraph', text: 'Output diffing compared row counts, checksums, and distribution sketches between old and new pipelines for every dataset in every wave. Diffs above the 0.01% threshold blocked cutover automatically; eleven datasets tripped the gate and were fixed before their waves proceeded.' },
        { kind: 'heading', level: 1, text: 'Measured outcomes' },
        { kind: 'table', headers: ['Metric', 'Before', 'After', 'Delta'], rows: [['Processing cost / month', '$108K', '$67K', '-38%'], ['Freshness (median)', '24 h', '1 h', '-96%'], ['p95 pipeline latency', '312 min', '204 min', '-35%'], ['On-call pages / month', '41', '17', '-59%'], ['Duplicate ingestion cost', '$41K', '$0', '-100%']] },
        { kind: 'figure', caption: 'Processing cost fell in every migration wave', chart: { kind: 'line', categories: ['Baseline', 'Wave 1', 'Wave 2', 'Wave 3', 'Wave 4'], series: [{ name: 'Cost $K/mo', values: [108, 96, 84, 73, 67] }] } },
        { kind: 'heading', level: 1, text: 'Incidents and lessons' },
        { kind: 'paragraph', text: 'Two incidents occurred during the migration, both in Wave 3. A schema drift in a partner feed produced silent nulls for six hours before the freshness monitor caught it, and a misconfigured retry policy amplified a transient storage error into a four-hour backlog. Neither reached customer-visible datasets.' },
        { kind: 'bulleted_list', items: ['Schema contracts now validate at ingestion, not transformation', 'Retry policies are linted against the amplification pattern', 'Freshness monitors alert at half the previous threshold'] },
        { kind: 'heading', level: 1, text: 'Recommendations for Q4' },
        { kind: 'paragraph', text: 'Three follow-on investments would compound the migration gains: extending the output-diffing harness to the serving layer, decommissioning the four legacy schedulers that remain in read-only mode, and automating the dataset onboarding path that still requires a platform engineer for roughly two hours per new dataset.' },
        { kind: 'quote', text: 'The parallel-run discipline made this the least eventful large migration we have run.', attribution: 'Head of Data Platform' },
      ],
    },
  },
  {
    id: '15-redline-memo',
    kind: 'docx',
    prompt: 'DOCX: contract redline memo exercising named styles',
    spec: {
      metadata: { title: 'Redline Memo — Corewell MSA Renewal', author: 'Legal' },
      blocks: [
        { kind: 'heading', level: 1, text: 'Summary of positions' },
        { kind: 'paragraph', text: 'Corewell returned the MSA renewal with eleven redlines. We accept six as drafted, propose compromise language on three, and reject two. This memo records each position and the fallback for the two rejections ahead of the October 22 call.' },
        { kind: 'heading', level: 1, text: 'Accepted redlines' },
        { kind: 'bulleted_list', items: ['Notice period extended from 30 to 45 days', 'Quarterly business reviews made contractual', 'Data export format committed to CSV and Parquet', 'Subprocessor list notification within 10 days', 'Invoice dispute window extended to 20 days', 'Governing law moved to Delaware'] },
        { kind: 'heading', level: 1, text: 'Compromise positions' },
        { kind: 'heading', level: 2, text: 'Liability cap' },
        { kind: 'paragraph', text: 'Corewell proposes raising the cap from 12 to 36 months of fees. We propose 24 months with carve-outs unchanged, matching the position accepted in the two most recent enterprise renewals.' },
        { kind: 'heading', level: 2, text: 'Service credits' },
        { kind: 'paragraph', text: 'Corewell proposes automatic credits at 99.9% availability. We propose credits beginning at 99.5% with the existing claim process, and a commitment to publish the availability dashboard they requested.' },
        { kind: 'heading', level: 2, text: 'Renewal pricing' },
        { kind: 'paragraph', text: 'Corewell proposes a 3% cap on annual increases. We propose 5% with a three-year term, or 3% with a five-year term — either protects the account economics that justified the original discount.' },
        { kind: 'heading', level: 1, text: 'Rejected redlines' },
        { kind: 'table', headers: ['Clause', 'Corewell position', 'Our position', 'Fallback'], rows: [['IP indemnity scope', 'Unlimited', 'Capped at 2x fees', 'Escalate to GC'], ['Source code escrow', 'Required', 'Reject', 'SOC 2 + continuity letter']] },
        { kind: 'quote', text: 'Escrow has never been granted in any agreement; the continuity letter has satisfied every prior request.', attribution: 'General Counsel' },
        { kind: 'heading', level: 1, text: 'Next steps' },
        { kind: 'numbered_list', items: ['Circulate this memo to the deal team by October 18', 'Confirm GC availability for the October 22 call', 'Prepare the continuity letter as the escrow fallback'] },
      ],
    },
  },
  {
    id: '16-budget-model',
    kind: 'xlsx',
    prompt: 'XLSX: 12-month budget model with formulas + variance column (zero-error gate must pass)',
    spec: {
      sheets: [
        {
          name: 'Budget 2027',
          table_style: 'TableStyleMedium9',
          columns: [
            { header: 'Month', format: 'text' },
            { header: 'Payroll', format: 'currency', role: 'input' },
            { header: 'Cloud', format: 'currency', role: 'input' },
            { header: 'Marketing', format: 'currency', role: 'input' },
            { header: 'Total', format: 'currency', role: 'formula' },
            { header: 'Plan', format: 'currency', role: 'input' },
            { header: 'Variance', format: 'currency', role: 'formula' },
          ],
          rows: [
            ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => {
              const r = i + 2;
              return [{ t: m }, { n: 84000 + i * 1500 }, { n: 12100 + i * 300 }, { n: 15000 + (i % 3) * 2000 }, { f: `=SUM(B${r}:D${r})` }, { n: 112000 + i * 1800 }, { f: `=F${r}-E${r}` }];
            }),
            [{ t: 'Total' }, { f: '=SUM(B2:B13)' }, { f: '=SUM(C2:C13)' }, { f: '=SUM(D2:D13)' }, { f: '=SUM(E2:E13)' }, { f: '=SUM(F2:F13)' }, { f: '=SUM(G2:G13)' }],
          ],
        },
      ],
    },
  },
  {
    id: '17-sales-pipeline',
    kind: 'xlsx',
    prompt: 'XLSX: sales pipeline workbook (table style, freeze panes, number formats)',
    spec: {
      sheets: [
        {
          name: 'Pipeline Q4',
          table_style: 'TableStyleMedium2',
          columns: [
            { header: 'Account', format: 'text' },
            { header: 'Stage', format: 'text' },
            { header: 'Owner', format: 'text' },
            { header: 'Value', format: 'currency', role: 'input' },
            { header: 'Probability', format: 'percent', role: 'input' },
            { header: 'Weighted', format: 'currency', role: 'formula' },
          ],
          rows: [
            [{ t: 'Corewell' }, { t: 'Negotiation' }, { t: 'Kim' }, { n: 240000 }, { n: 0.8 }, { f: '=D2*E2' }],
            [{ t: 'Nordic Freight' }, { t: 'Proposal' }, { t: 'Alvarez' }, { n: 180000 }, { n: 0.5 }, { f: '=D3*E3' }],
            [{ t: 'Basalt Health' }, { t: 'Discovery' }, { t: 'Kim' }, { n: 310000 }, { n: 0.2 }, { f: '=D4*E4' }],
            [{ t: 'Juniper Media' }, { t: 'Negotiation' }, { t: 'Osei' }, { n: 95000 }, { n: 0.7 }, { f: '=D5*E5' }],
            [{ t: 'Total' }, null, null, { f: '=SUM(D2:D5)' }, null, { f: '=SUM(F2:F5)' }],
          ],
        },
      ],
    },
  },
  {
    id: '18-client-report',
    kind: 'pdf',
    prompt: 'PDF: branded 4-page client report (running header/footer, page counter, no broken tables)',
    spec: {
      meta: { title: 'Axiom Engagement Report — Corewell Q3', page_size: 'Letter', margins_in: { top: 0.9, right: 0.85, bottom: 0.9, left: 0.85 } },
      sections: [
        { kind: 'heading', level: 1, text: 'Axiom Engagement Report — Corewell Q3' },
        { kind: 'paragraph', text: 'This report summarizes the third quarter of the Corewell engagement: the close-automation rollout across all 40 stores, the measured outcomes against the success criteria agreed in April, and the recommended focus for the fourth quarter. All figures are drawn from the shared telemetry workspace and were reviewed with the Corewell operations team on September 28.' },
        { kind: 'heading', level: 2, text: 'Engagement summary' },
        { kind: 'paragraph', text: 'The quarter closed all three success criteria. Month-end close time fell from twelve days to three, post-close corrections dropped to zero for five consecutive months, and the finance team reclaimed roughly 140 analyst-hours per month. The wave-based rollout completed without a single store losing transaction capture, and the final wave of 36 stores migrated over a single weekend.' },
        { kind: 'bulleted_list', items: ['Close time: 12 days to 3 days against a 5-day target', 'Post-close corrections: zero for five consecutive months', 'Analyst hours reclaimed: about 140 per month', 'Store migrations completed: 40 of 40 with zero downtime'] },
        { kind: 'heading', level: 2, text: 'Adoption and usage' },
        { kind: 'paragraph', text: 'Daily active usage in the finance workspace reached 94% of licensed seats by the end of the quarter. The automation checklist is now the system of record for the close, and the audit team began using the run log directly in September, removing a weekly export that previously consumed four hours.' },
        { kind: 'figure', caption: 'Month-end close time by month, days', chart: { kind: 'line', categories: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'], series: [{ name: 'Close days', values: [12, 9, 7, 5, 4, 3] }] } },
        { kind: 'heading', level: 2, text: 'Outcomes against success criteria' },
        { kind: 'table', headers: ['Criterion', 'Target', 'Actual', 'Status'], rows: [['Close time', '5 days', '3 days', 'Exceeded'], ['Corrections', '< 2 / month', '0', 'Exceeded'], ['Analyst hours saved', '100 / month', '140', 'Exceeded'], ['Store coverage', '40 stores', '40 stores', 'Met']] },
        { kind: 'heading', level: 2, text: 'Incidents and support' },
        { kind: 'paragraph', text: 'One support incident occurred during the quarter: a ledger mapping error in the August wave produced duplicate journal lines for two stores, caught by the reconciliation gate before posting. The fix shipped within six hours and the gate that caught it is now part of the standard rollout checklist. Support ticket volume fell 62% quarter over quarter as the self-serve runbook matured.' },
        { kind: 'heading', level: 2, text: 'Recommendations for Q4' },
        { kind: 'numbered_list', items: ['Extend close automation to the two remaining regional entities', 'Adopt the audit-log API to retire the last manual export', 'Schedule the annual disaster-recovery rehearsal for November', 'Review license count against the 94% utilization figure'] },
        { kind: 'paragraph', text: 'The engagement moves to quarterly cadence from October. The Axiom team thanks the Corewell operations and finance teams for a quarter of disciplined execution; the working relationship on the reconciliation gate in particular is the reason the August incident stayed invisible to store operations.' },
        { kind: 'quote', text: 'The close went from the worst week of the month to a non-event.', attribution: 'Controller, Corewell' },
      ],
    },
  },
];

// ── new-schema → old-schema downgrades (BEFORE builders) ────────────────────
function oldPptx(spec: Record<string, unknown>): Record<string, unknown> {
  const slides = (spec.slides as Array<Record<string, unknown>>).map((s) => {
    const base: Record<string, unknown> = { heading: s.title || 'Untitled' };
    if (s.speaker_notes) base.notes = s.speaker_notes;
    switch (s.archetype) {
      case 'title': return { ...base, layout: 'title', subtitle: s.subtitle };
      case 'agenda': return { ...base, layout: 'bullets', bullets: s.bullets };
      case 'section_divider': return { ...base, layout: 'section', subtitle: s.subtitle };
      case 'content_bullets': return { ...base, layout: 'bullets', bullets: s.bullets };
      case 'content_chart': {
        const c = s.chart as Record<string, unknown>;
        return { ...base, layout: 'chart', chart: { kind: c.kind, labels: c.categories, series: c.series } };
      }
      case 'comparison': {
        const cols = s.columns as Array<{ head: string; items: string[] }>;
        return { ...base, layout: 'two_col', col_left_head: cols[0]?.head, col_left: cols[0]?.items, col_right_head: cols[1]?.head, col_right: cols[1]?.items };
      }
      case 'big_stat': {
        const st = s.stat as { value: string; label: string };
        return { ...base, layout: 'stat', stats: [{ value: st.value, label: st.label }] };
      }
      case 'quote': return { ...base, heading: s.quote, layout: 'quote', quote: s.quote, attribution: s.attribution };
      case 'timeline_process': {
        const steps = s.steps as Array<{ label: string; detail?: string }>;
        return { ...base, layout: 'bullets', bullets: steps.map((st, i) => `${i + 1}. ${st.label}${st.detail ? ` — ${st.detail}` : ''}`) };
      }
      case 'two_column': return { ...base, layout: 'two_col', col_left: s.bullets, col_right: s.stat ? [`${(s.stat as { value: string }).value} ${(s.stat as { label: string }).label}`] : [] };
      case 'table': {
        const t = s.table as { headers: string[]; rows: string[][] };
        return { ...base, layout: 'bullets', bullets: t.rows.slice(0, 6).map((r) => r.join(' · ')) };
      }
      case 'closing_cta': return { ...base, layout: 'closing', subtitle: s.subtitle };
      default: return { ...base, layout: 'bullets', bullets: s.bullets ?? [] };
    }
  });
  return { title: spec.title, slides };
}

function oldDocx(spec: Record<string, unknown>): Record<string, unknown> {
  const blocks = spec.blocks as Array<Record<string, unknown>>;
  const sections: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;
  for (const b of blocks) {
    if (b.kind === 'heading') {
      current = { heading: b.text, level: b.level, paragraphs: [] };
      sections.push(current);
    } else if (current) {
      const paras = current.paragraphs as string[];
      if (b.kind === 'paragraph' || b.kind === 'quote') paras.push(String(b.text));
      else if (b.kind === 'bulleted_list' || b.kind === 'numbered_list') paras.push((b.items as string[]).join('; '));
      else if (b.kind === 'table') current.table = { headers: b.headers, rows: b.rows };
      else if (b.kind === 'figure') paras.push(`Figure: ${b.caption}`);
    }
  }
  return { metadata: spec.metadata, sections };
}

function oldXlsx(spec: Record<string, unknown>): Record<string, unknown> {
  const sheets = (spec.sheets as Array<Record<string, unknown>>).map((sheet) => {
    const columns = sheet.columns as Array<{ header: string }>;
    const cells: Array<Record<string, unknown>> = [];
    columns.forEach((c, i) => cells.push({ ref: `${String.fromCharCode(65 + i)}1`, valueText: c.header, format: 'header' }));
    (sheet.rows as Array<Array<Record<string, unknown> | null>>).forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const ref = `${String.fromCharCode(65 + c)}${r + 2}`;
        if ('f' in cell) cells.push({ ref, formula: cell.f });
        else if ('n' in cell) cells.push({ ref, valueNumber: cell.n });
        else cells.push({ ref, valueText: cell.t });
      });
    });
    return { name: sheet.name, cells };
  });
  return { sheets };
}

function oldPdf(spec: Record<string, unknown>): Record<string, unknown> {
  const sections = spec.sections as Array<Record<string, unknown>>;
  const blocks: Array<Record<string, unknown>> = [];
  for (const s of sections) {
    if (s.kind === 'heading') blocks.push({ kind: 'heading', text: s.text });
    else if (s.kind === 'paragraph' || s.kind === 'quote') blocks.push({ kind: 'para', text: s.text });
    else if (s.kind === 'bulleted_list' || s.kind === 'numbered_list') blocks.push({ kind: 'para', text: (s.items as string[]).join('; ') });
    else if (s.kind === 'table') blocks.push({ kind: 'table', headers: s.headers, rows: s.rows });
    else if (s.kind === 'figure') blocks.push({ kind: 'para', text: `Figure: ${s.caption}` });
  }
  // old schema: pages of blocks — split roughly every 8 blocks
  const pages: Array<Record<string, unknown>> = [];
  for (let i = 0; i < blocks.length; i += 8) pages.push({ blocks: blocks.slice(i, i + 8) });
  return { pages };
}

const DOWNGRADE: Record<Kind, (s: Record<string, unknown>) => Record<string, unknown>> = {
  pptx: oldPptx, docx: oldDocx, xlsx: oldXlsx, pdf: oldPdf,
};

// ── harness ─────────────────────────────────────────────────────────────────
function sh(cmd: string, args: string[], opts: Record<string, unknown> = {}): string {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd: repoRoot, ...opts });
}

function baselineSha(): string {
  const a = sh('git', ['log', '--format=%H', '--grep', '^A: design doctrine']).trim().split('\n').pop();
  if (!a) throw new Error('baseline commit (A) not found');
  return sh('git', ['rev-parse', `${a}^`]).trim();
}

function extractBefore(sha: string): string {
  const dir = path.join(outRoot, 'builders-before');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  sh('bash', ['-c', `git archive ${sha} scripts/office | tar -x -C ${JSON.stringify(dir)}`]);
  return path.join(dir, 'scripts/office');
}

interface RunResult { built: boolean; error?: string; findings: string[]; pass: boolean }

function buildAndScore(kind: Kind, spec: Record<string, unknown>, builderDir: string, outDir: string, id: string): RunResult {
  mkdirSync(outDir, { recursive: true });
  const payloadFile = path.join(outDir, `${id}.payload.json`);
  const outFile = path.join(outDir, `${id}.${kind}`);
  writeFileSync(payloadFile, JSON.stringify(spec));
  const template = kind === 'pptx'
    ? path.join(repoRoot, 'skills/pptx/templates/dfs_default.potx')
    : path.join(repoRoot, 'skills/docx/templates/axiom_default.dotx');
  try {
    sh(py, [path.join(builderDir, `build_${kind}.py`), '--payload', payloadFile, '--out', outFile, '--template', template], { cwd: builderDir });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    return { built: false, error: stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 160), findings: [], pass: false };
  }
  if (!existsSync(outFile)) return { built: false, error: 'no output file', findings: [], pass: false };
  try {
    const raw = sh(py, [path.join(repoRoot, 'scripts/test/design_score.py'), kind, outFile, payloadFile]);
    const scored = JSON.parse(raw.trim().split('\n').pop() ?? '{}') as { pass: boolean; findings: string[] };
    return { built: true, findings: scored.findings, pass: scored.pass };
  } catch (err) {
    return { built: true, error: `scorer failed: ${String(err).slice(0, 120)}`, findings: ['scorer failed'], pass: false };
  }
}

async function main(): Promise<void> {
  const sha = baselineSha();
  console.log(`baseline (pre-doctrine): ${sha.slice(0, 8)}`);
  const beforeDir = extractBefore(sha);
  const afterDir = path.join(repoRoot, 'scripts/office');

  const rows: Array<{ id: string; kind: Kind; before: RunResult; after: RunResult }> = [];
  for (const ev of EVALS) {
    const before = buildAndScore(ev.kind, DOWNGRADE[ev.kind](ev.spec), beforeDir, path.join(outRoot, 'before'), ev.id);
    const after = buildAndScore(ev.kind, ev.spec, afterDir, path.join(outRoot, 'after'), ev.id);
    rows.push({ id: ev.id, kind: ev.kind, before, after });
    const fmt = (r: RunResult) => (!r.built ? `build-fail(${r.error?.slice(0, 60)})` : r.pass ? 'PASS' : `FAIL(${r.findings.length})`);
    console.log(`${ev.id.padEnd(26)} ${ev.kind}  before: ${fmt(before).padEnd(28)} after: ${fmt(after)}`);
    if (!after.pass) for (const f of after.findings.slice(0, 4)) console.log(`    after-finding: ${f}`);
  }

  const passRate = (sel: (r: (typeof rows)[number]) => RunResult) =>
    `${rows.filter((r) => sel(r).pass).length}/${rows.length}`;
  console.log('\n== summary ==');
  console.log(`BEFORE pass rate: ${passRate((r) => r.before)}`);
  console.log(`AFTER  pass rate: ${passRate((r) => r.after)}`);
  const beforeFindings = rows.reduce((n, r) => n + r.before.findings.length, 0);
  const afterFindings = rows.reduce((n, r) => n + r.after.findings.length, 0);
  console.log(`findings: before=${beforeFindings} after=${afterFindings}`);
  // markdown table for DESIGN-LOG
  console.log('\n| Eval | Kind | Before | After |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    const cell = (x: RunResult) => (!x.built ? `build fail` : x.pass ? 'pass' : `${x.findings.length} findings`);
    console.log(`| ${r.id} | ${r.kind} | ${cell(r.before)} | ${cell(r.after)} |`);
  }
  if (rows.some((r) => !r.after.pass)) {
    console.error('\nEVAL FAILED: not every AFTER output passes the deterministic gates');
    process.exit(1);
  }
  console.log('\nall AFTER outputs pass the deterministic gates');
}

await main();
