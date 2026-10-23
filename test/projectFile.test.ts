import { describe, expect, it } from "vitest";
import { PROJECT_FILE_KIND, PROJECT_FILE_VERSION, parseProjectFile, projectFileName, serializeProjectFile } from "../src/persistence/projectFile";
import { addAsset, addNote, assignAsset, createInitialProject } from "../src/model/project";
import type { Asset, Project } from "../src/model/types";

const asset = (id: number, name: string): Asset => ({ id, name, type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" });

function sample(): { project: Project; assets: Map<number, ArrayBuffer> } {
  let project = createInitialProject();
  project = { ...project, name: "My Song" };
  project = addAsset(project, asset(5, "kick.wav"));
  project = addAsset(project, asset(6, "snare.wav"));
  project = assignAsset(project, "track-1", 5);
  project = addNote(project, project.patterns[0].id, "track-1", 4);
  const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 256); // bigger than one base64 chunk
  return {
    project,
    assets: new Map<number, ArrayBuffer>([
      [5, big.buffer],
      [6, new Uint8Array([1, 2, 3]).buffer],
      [77, new Uint8Array([9]).buffer], // not in the project: must not be written
    ]),
  };
}

describe("project file", () => {
  it("round-trips the project and the bytes of the assets it uses", () => {
    const { project, assets } = sample();
    const text = serializeProjectFile(project, assets, new Date("2026-10-23T12:00:00Z"));
    const file = JSON.parse(text);
    expect(file.kind).toBe(PROJECT_FILE_KIND);
    expect(file.formatVersion).toBe(PROJECT_FILE_VERSION);
    expect(file.savedAt).toBe("2026-10-23T12:00:00.000Z");
    expect(Object.keys(file.assets).sort()).toEqual(["5", "6"]);

    const opened = parseProjectFile(text);
    expect(opened.project).toEqual(project);
    expect([...opened.assetData.keys()].sort()).toEqual([5, 6]);
    expect(new Uint8Array(opened.assetData.get(5)!)).toEqual(new Uint8Array(assets.get(5)!));
    expect(new Uint8Array(opened.assetData.get(6)!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("explains what is wrong with a file it cannot open", () => {
    const { project, assets } = sample();
    const good = JSON.parse(serializeProjectFile(project, assets));
    expect(() => parseProjectFile("{nope")).toThrow(/not valid JSON/);
    expect(() => parseProjectFile(JSON.stringify({ hello: 1 }))).toThrow(/not a webseq project file/);
    expect(() => parseProjectFile(JSON.stringify({ ...good, kind: "webtracker-project" }))).toThrow(/not a webseq project file/);
    expect(() => parseProjectFile(JSON.stringify({ ...good, formatVersion: undefined }))).toThrow(/no version/);
    expect(() => parseProjectFile(JSON.stringify({ ...good, formatVersion: PROJECT_FILE_VERSION + 1 }))).toThrow(/newer webseq/);
    expect(() => parseProjectFile(JSON.stringify({ ...good, project: { id: "x" } }))).toThrow(/damaged/);
  });

  it("opens a file whose asset bytes are missing or unreadable, skipping just those assets", () => {
    const { project, assets } = sample();
    const file = JSON.parse(serializeProjectFile(project, assets));
    delete file.assets["6"];
    file.assets["5"] = "%%% not base64 %%%";
    const opened = parseProjectFile(JSON.stringify(file));
    expect(opened.assetData.size).toBe(0);
    expect(opened.project.assets).toHaveLength(2); // the project still lists them
  });

  it("opens a project that lacks fields added later (they are read through defaults)", () => {
    const { project, assets } = sample();
    const file = JSON.parse(serializeProjectFile(project, assets));
    delete file.project.scale;
    delete file.project.swing;
    expect(() => parseProjectFile(JSON.stringify(file))).not.toThrow();
  });

  it("names the file after the project, safely", () => {
    expect(projectFileName({ name: "My Song" })).toBe("My Song.webseq.json");
    expect(projectFileName({ name: '  a/b\\c:d*e?"f<g>h|i  ' })).toBe("a-b-c-d-e-f-g-h-i.webseq.json");
    expect(projectFileName({ name: "" })).toBe("project.webseq.json");
    expect(projectFileName({ name: "...hidden" })).toBe("hidden.webseq.json");
    expect(projectFileName({ name: "x".repeat(200) }).length).toBeLessThan(100);
  });
});
