import type { Decision } from "@gg/shared";
import type { PageSubmission } from "../selectors";

interface Props {
  page: PageSubmission | null;
  decisions: Decision[];
  alertsRaised: number;
  alertsAligned: number;
  totalSubmissions: number;
}

const COLORS = ["#2563eb", "#d97706", "#059669", "#dc2626", "#7c3aed", "#0891b2"];

/** Latest decision per (criterion, submission), sorted by submission index. */
function latestSeries(decisions: Decision[]) {
  const latest = new Map<string, Decision>();
  for (const d of decisions) {
    const k = `${d.criterionId}|${d.submissionId}`;
    const prev = latest.get(k);
    if (!prev || d.at > prev.at) latest.set(k, d);
  }
  const byCrit = new Map<string, Decision[]>();
  for (const d of latest.values()) {
    const arr = byCrit.get(d.criterionId) ?? [];
    arr.push(d);
    byCrit.set(d.criterionId, arr);
  }
  for (const arr of byCrit.values()) arr.sort((a, b) => a.submissionIndex - b.submissionIndex);
  return { byCrit, all: [...latest.values()].sort((a, b) => a.submissionIndex - b.submissionIndex || a.at - b.at) };
}

export function SessionTab({ page, decisions, alertsRaised, alertsAligned, totalSubmissions }: Props) {
  const { byCrit, all } = latestSeries(decisions);
  const maxDeduction = Math.max(5, ...(page?.rubric.map((r) => r.maxPoints) ?? []));
  const maxIndex = Math.max(totalSubmissions, ...all.map((d) => d.submissionIndex));

  const W = 340, H = 170, PL = 28, PR = 8, PT = 10, PB = 22;
  const x = (i: number) => PL + ((i - 1) / Math.max(1, maxIndex - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / maxDeduction) * (H - PT - PB);

  // Running mean deduction by submission order.
  const meanPts: string[] = [];
  let sum = 0, n = 0, lastIdx = -1;
  for (const d of all) {
    sum += d.deduction; n += 1;
    if (d.submissionIndex !== lastIdx) { lastIdx = d.submissionIndex; meanPts.push(`${x(d.submissionIndex)},${y(sum / n)}`); }
    else meanPts[meanPts.length - 1] = `${x(d.submissionIndex)},${y(sum / n)}`;
  }

  const critIds = page?.rubric.map((r) => r.criterionId) ?? [...byCrit.keys()];
  const gradedSubs = new Set(all.map((d) => d.submissionId)).size;

  return (
    <>
      <div className="gg-stats">
        <div className="gg-stat"><div className="gg-n" data-gg-stat-graded>{gradedSubs}</div><div className="gg-l">graded</div></div>
        <div className="gg-stat"><div className="gg-n" data-gg-stat-alerts>{alertsRaised}</div><div className="gg-l">alerts</div></div>
        <div className="gg-stat"><div className="gg-n" data-gg-stat-aligned>{alertsAligned}</div><div className="gg-l">aligned</div></div>
      </div>

      {all.length === 0 ? (
        <div className="gg-status">Score a few criteria and the strictness curve will appear here.</div>
      ) : (
        <>
          <svg className="gg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Deduction per criterion over submission order" data-gg-chart>
            {[0, maxDeduction / 2, maxDeduction].map((v) => (
              <g key={v}>
                <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e6e9ec" strokeWidth={1} />
                <text x={PL - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#8a949c">−{v}</text>
              </g>
            ))}
            {Array.from({ length: maxIndex }, (_, i) => i + 1).filter((i) => i === 1 || i % 5 === 0 || i === maxIndex).map((i) => (
              <text key={i} x={x(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="#8a949c">#{i}</text>
            ))}
            {critIds.map((cid, ci) => {
              const pts = byCrit.get(cid);
              if (!pts || pts.length === 0) return null;
              const color = COLORS[ci % COLORS.length]!;
              return (
                <g key={cid} data-gg-series={cid}>
                  {pts.length > 1 && <polyline fill="none" stroke={color} strokeWidth={1.6} points={pts.map((d) => `${x(d.submissionIndex)},${y(d.deduction)}`).join(" ")} />}
                  {pts.map((d) => <circle key={d.id} cx={x(d.submissionIndex)} cy={y(d.deduction)} r={2.6} fill={color} />)}
                </g>
              );
            })}
            {meanPts.length > 1 && <polyline fill="none" stroke="#1f2a33" strokeWidth={1.4} strokeDasharray="4 3" points={meanPts.join(" ")} data-gg-mean />}
          </svg>
          <div className="gg-legend">
            {critIds.map((cid, ci) => (
              <span key={cid} style={{ color: COLORS[ci % COLORS.length] }}>{page?.rubric.find((r) => r.criterionId === cid)?.title ?? cid}</span>
            ))}
            <span style={{ color: "#1f2a33" }}>running mean</span>
          </div>
          <div className="gg-footnote">Higher means harsher. A rising mean with the same omissions is intra-rater drift.</div>
        </>
      )}
    </>
  );
}
