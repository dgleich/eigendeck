// "Which recording do you want to keep?" chooser for promoting an animation
// link to a sync. Promote is destructive — the linked copies collapse into one
// element — so when they hold different notebook recordings we ask which one
// survives. The picked copy becomes the master (its recording is kept; the
// others are discarded). Shown only on a real conflict (2+ different
// recordings); a single/no recording promotes without asking.

interface Candidate {
  elementId: string;
  slideNo: number;     // 1-based, for display
  summary: string;     // summarizeOverlay() of this copy's recording
}

export function PromoteChooser({ candidates, onPick, onCancel }: {
  candidates: Candidate[];
  onPick: (elementId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="link-overlay" onClick={onCancel}>
      <div className="link-overlay-content" onClick={(e) => e.stopPropagation()}>
        <div className="link-overlay-header">
          <span>These linked notebooks have different recordings — keep which one?
            The others are discarded.</span>
          <button className="link-overlay-close" onClick={onCancel}>Cancel</button>
        </div>
        <div className="overlay-conflict-choices">
          {candidates.map((c) => (
            <button key={c.elementId} className="overlay-conflict-card"
              onClick={() => onPick(c.elementId)}>
              <strong>Slide {c.slideNo}</strong>
              <span>{c.summary}</span>
              <em>Keep this recording</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
