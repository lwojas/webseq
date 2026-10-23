import { describe, expect, it, vi } from "vitest";
import type { HostStateBridge, HostStateSnapshot } from "webdsp";
import { HOST_STATE_APP, HOST_STATE_FORMAT, fromHostSnapshot, publishRecord, toHostSnapshot } from "../src/persistence/hostState";
import { addAsset, assignAsset, createInitialProject } from "../src/model/project";
import type { RecoveryRecord } from "../src/persistence/recovery";
import type { Asset } from "../src/model/types";

function record(): { record: RecoveryRecord; assets: Map<number, ArrayBuffer> } {
  let project = createInitialProject();
  const asset = (id: number, name: string): Asset => ({ id, name, type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" });
  project = addAsset(project, asset(11, "kick.wav"));
  project = addAsset(project, asset(12, "snare.wav"));
  project = assignAsset(project, "track-1", 11);
  const assets = new Map<number, ArrayBuffer>([
    [11, new Uint8Array([1, 2, 3]).buffer],
    [12, new Uint8Array([4, 5]).buffer],
    [99, new Uint8Array([9]).buffer], // not in the project: must not be published
  ]);
  return {
    record: {
      projectId: project.id,
      projectName: project.name,
      savedAt: 1,
      project,
      ui: { selectedPatternId: project.patterns[0].id, selectedTarget: "track-1", activeBank: 0, gridResolution: 1 },
    },
    assets,
  };
}

describe("host state snapshot", () => {
  it("stamps the app and format, carries the record as JSON, and only the assets the project uses, by id", () => {
    const { record: r, assets } = record();
    const s = toHostSnapshot(r, assets);
    expect(s.app).toBe(HOST_STATE_APP);
    expect(s.format).toBe(HOST_STATE_FORMAT);
    expect(Object.keys(s.blobs).sort()).toEqual(["11", "12"]);
    expect(s.blobs["11"]).toBe(assets.get(11)); // the same buffer object, so the host need not resend it
    expect(JSON.parse(s.data).projectId).toBe(r.projectId);
  });

  it("round-trips through publish and restore", () => {
    const { record: r, assets } = record();
    const publish = vi.fn();
    publishRecord({ publish, clear: vi.fn(), onRestore: vi.fn() } as unknown as HostStateBridge, r, assets);
    const snapshot = publish.mock.calls[0][0] as HostStateSnapshot;
    const restored = fromHostSnapshot(snapshot);
    expect(restored?.record).toEqual(r);
    expect([...restored!.assetData.keys()].sort()).toEqual([11, 12]);
    expect(restored!.assetData.get(11)).toBe(assets.get(11));
  });

  it("refuses another app's state, an unknown format, malformed JSON and a record that does not validate", () => {
    const { record: r, assets } = record();
    const good = toHostSnapshot(r, assets);
    expect(fromHostSnapshot({ ...good, app: "webtracker" })).toBeNull();
    expect(fromHostSnapshot({ ...good, format: HOST_STATE_FORMAT + 1 })).toBeNull();
    expect(fromHostSnapshot({ ...good, data: "{not json" })).toBeNull();
    expect(fromHostSnapshot({ ...good, data: JSON.stringify({ projectId: "x" }) })).toBeNull();
  });

  it("restores a project whose asset bytes are missing (the asset is simply not loaded)", () => {
    const { record: r, assets } = record();
    const snapshot = toHostSnapshot(r, assets);
    delete snapshot.blobs["12"];
    const restored = fromHostSnapshot(snapshot);
    expect([...restored!.assetData.keys()]).toEqual([11]);
  });
});
