import { BANK_SIZE, type BankSummary } from "../model/project";

interface Props {
  activeBank: number;
  /** One entry per bank, in order (see summarizeBanks). */
  summaries: BankSummary[];
  onSelect: (bank: number) => void;
}

/** Tabs for the four 16-track banks (ECS-84). Each tab marks how many of its tracks are looping
 * and whether the selected pattern has notes there, so a bank's contents are visible without
 * switching to it. Switching only changes what the grid shows. Playback and loops keep running. */
export function BankBar({ activeBank, summaries, onSelect }: Props) {
  return (
    <div className="bank-bar" role="tablist" aria-label="Track banks">
      {summaries.map((summary, bank) => {
        const first = bank * BANK_SIZE + 1;
        const last = first + BANK_SIZE - 1;
        const active = bank === activeBank;
        const letter = String.fromCharCode(65 + bank);
        return (
          <button
            key={bank}
            role="tab"
            aria-selected={active}
            className={`bank-tab ${active ? "active" : ""}`}
            title={`Tracks ${String(first).padStart(2, "0")}–${String(last).padStart(2, "0")}`}
            onClick={() => onSelect(bank)}
          >
            <span className="bank-tab-letter">{letter}</span>
            <span className="bank-tab-range">
              {String(first).padStart(2, "0")}–{String(last).padStart(2, "0")}
            </span>
            {summary.loopCount > 0 && (
              <span className="bank-tab-loops" aria-label={`${summary.loopCount} looping`}>
                ● {summary.loopCount}
              </span>
            )}
            {summary.hasNotes && <span className="bank-tab-notes" aria-label="has notes in this pattern" />}
          </button>
        );
      })}
    </div>
  );
}
