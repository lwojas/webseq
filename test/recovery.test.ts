import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecoveryScheduler, parseRecoveryRecord, timeAgo, type RecoverySnapshot } from "../src/persistence/recovery";
import { createInitialProject } from "../src/model/project";

afterEach(() => vi.useRealTimers());

function snapshot(): RecoverySnapshot {
  const project = createInitialProject();
  return { project, ui: { selectedPatternId: project.patterns[0].id, selectedTarget: "master", activeBank: 0, gridResolution: 1 } };
}

describe("createRecoveryScheduler", () => {
  it("collapses a burst into one write after the debounce", () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const s = createRecoveryScheduler({ write, debounceMs: 1500, getNow: () => 42 });
    for (let i = 0; i < 10; i++) {
      s.schedule(snapshot());
      vi.advanceTimersByTime(100);
    }
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ savedAt: 42, projectName: expect.any(String) });
  });

  it("cancel drops a pending write", () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const s = createRecoveryScheduler({ write });
    s.schedule(snapshot());
    s.cancel();
    vi.advanceTimersByTime(10_000);
    expect(write).not.toHaveBeenCalled();
  });

  it("swallows a failed write", async () => {
    vi.useFakeTimers();
    const s = createRecoveryScheduler({ write: () => Promise.reject(new Error("quota")) });
    s.schedule(snapshot());
    await vi.advanceTimersByTimeAsync(2000);
  });
});

describe("parseRecoveryRecord", () => {
  const good = () => {
    const { project, ui } = snapshot();
    return { id: "latest", projectId: project.id, projectName: project.name, savedAt: 1, project, ui };
  };
  it("accepts a well-formed record", () => expect(parseRecoveryRecord(good())).not.toBeNull());
  it.each([undefined, null, 5, "x", {}, { ...good(), project: null }, { ...good(), ui: {} }, { ...good(), savedAt: "now" }, { ...good(), project: { ...good().project, patterns: [] } }, { ...good(), project: { ...good().project, tracks: "no" } }])(
    "rejects malformed data %#",
    (raw) => expect(parseRecoveryRecord(raw)).toBeNull(),
  );
});

describe("timeAgo", () => {
  it("formats", () => {
    expect(timeAgo(0, 10_000)).toBe("moments ago");
    expect(timeAgo(0, 120_000)).toBe("2 minutes ago");
    expect(timeAgo(0, 3_600_000)).toBe("1 hour ago");
  });
});
