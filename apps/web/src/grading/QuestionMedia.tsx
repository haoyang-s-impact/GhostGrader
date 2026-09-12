import type { QuestionMedia as Media } from "@gg/shared";

/**
 * What students worked from: an audio player (with its transcript tucked away)
 * and images behind a disclosure, so the answer stays on screen while grading.
 */
export function QuestionMedia({ media }: { media: Media[] | undefined }) {
  if (!media?.length) return null;
  return (
    <div className="ws-media">
      {media.map((m) =>
        m.kind === "audio" ? (
          <div key={m.src} className="ws-media-item" data-question-media="audio">
            <div className="ws-media-label">{m.label}</div>
            <audio controls preload="metadata" src={m.src} />
            {m.transcript && (
              <details>
                <summary>Transcript</summary>
                <p className="ws-transcript">{m.transcript}</p>
              </details>
            )}
          </div>
        ) : (
          <details key={m.src} className="ws-media-item" data-question-media="image">
            <summary>{m.label}</summary>
            <img src={m.src} alt={m.label} />
          </details>
        ),
      )}
    </div>
  );
}
