import type { Decision } from "@gg/shared";

interface Props {
  decisions: Decision[];
  questionId: string | null;
  alertsRaised: number;
  alertsAligned: number;
  checksRaised: number;
  checksApproved: number;
  totalStudents: number;
  maxPoints: number;
}

function latest(decisions: Decision[]) {
  const m = new Map<string, Decision>();
  for (const d of decisions) {
    const prev = m.get(d.answerId);
    if (!prev || d.at > prev.at) m.set(d.answerId, d);
  }
  return [...m.values()].sort((a, b) => a.studentIndex - b.studentIndex);
}

export function SessionTab({ decisions, questionId, alertsRaised, alertsAligned, checksRaised, checksApproved, totalStudents, maxPoints }: Props) {
  const all = latest(decisions.filter((d) => !questionId || d.questionId === questionId));
  const yMax = Math.max(maxPoints, ...all.map((d) => d.maxPoints), 1);
  const maxIndex = Math.max(2, totalStudents, ...all.map((d) => d.studentIndex));
  const W = 360, H = 180, PL = 30, PR = 8, PT = 10, PB = 22;
  const x = (i: number) => PL + ((i - 1) / Math.max(1, maxIndex - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / yMax) * (H - PT - PB);
  const withSuggestion = all.filter((d) => d.suggestedPoints !== null);
  const offsets = withSuggestion.map((d) => d.points - (d.suggestedPoints as number));
  const meanOffset = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;

  return (
    <>
      <div className="gg-stats">
        <div className="gg-stat"><div className="gg-n" data-gg-stat-graded>{all.length}</div><div className="gg-l">graded</div></div>
        <div className="gg-stat"><div className="gg-n" data-gg-stat-alerts>{alertsRaised}</div><div className="gg-l">alerts</div></div>
        <div className="gg-stat"><div className="gg-n" data-gg-stat-aligned>{alertsAligned}</div><div className="gg-l">aligned</div></div>
      </div>
      <div className="gg-stats">
        <div className="gg-stat"><div className="gg-n">{checksRaised}</div><div className="gg-l">rubric checks</div></div>
        <div className="gg-stat"><div className="gg-n">{checksApproved}</div><div className="gg-l">approved</div></div>
        <div className="gg-stat"><div className="gg-n">{offsets.length ? (meanOffset > 0 ? "+" : "") + meanOffset.toFixed(1) : "–"}</div><div className="gg-l">mean vs rubric</div></div>
      </div>
      {all.length === 0 ? (
        <div className="gg-status">Save a page of marks and the comparison chart appears here.</div>
      ) : (
        <>
          <svg className="gg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Your mark and the rubric-referenced mark per student" data-gg-chart>
            {[0, yMax / 2, yMax].map((v) => (
              <g key={v}>
                <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e6e9ec" strokeWidth={1} />
                <text x={PL - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#8a949c">{v}</text>
              </g>
            ))}
            {withSuggestion.length > 1 && <polyline fill="none" stroke="#8a949c" strokeWidth={1.4} strokeDasharray="4 3" points={withSuggestion.map((d) => `${x(d.studentIndex)},${y(d.suggestedPoints as number)}`).join(" ")} />}
            {withSuggestion.map((d) => (
              <line key={`o${d.id}`} x1={x(d.studentIndex)} x2={x(d.studentIndex)} y1={y(d.suggestedPoints as number)} y2={y(d.points)} stroke={d.points >= (d.suggestedPoints as number) ? "#0b874b" : "#c0392b"} strokeWidth={2} opacity={0.5} />
            ))}
            {all.length > 1 && <polyline fill="none" stroke="#5b3df5" strokeWidth={1.8} points={all.map((d) => `${x(d.studentIndex)},${y(d.points)}`).join(" ")} />}
            {all.map((d) => <circle key={d.id} cx={x(d.studentIndex)} cy={y(d.points)} r={3} fill="#5b3df5" data-gg-point />)}
          </svg>
          <div className="gg-legend">
            <span style={{ color: "#5b3df5" }}>your mark</span>
            <span style={{ color: "#8a949c" }}>rubric-referenced</span>
            <span style={{ color: "#0b874b" }}>above rubric</span>
            <span style={{ color: "#c0392b" }}>below rubric</span>
          </div>
          <div className="gg-footnote">A mean that drifts across the session for the same kinds of gaps is intra-rater drift.</div>
        </>
      )}
    </>
  );
}
