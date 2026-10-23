// The browser/host glue for project files (see projectFile.ts for the format). Where the host has its own file dialogs
// (webdsp's getHostFiles(): a plugin's WebView has no file input and ignores downloads), they are used; in a browser it is
// a download link and a file input, as usual. Not unit-tested, like the other browser glue (it needs a real browser or
// host): everything that can be logic lives in projectFile.ts.
import { getHostFiles } from "webdsp";
import type { AssetId, Project } from "../model/types";
import { PROJECT_FILE_EXTENSION, parseProjectFile, projectFileName, serializeProjectFile, type ProjectFileResult } from "./projectFile";

/** Writes `project` (with its asset bytes) as a project file. Resolves true when it was saved, false if the user cancelled. */
export async function exportProjectFile(project: Project, assetData: ReadonlyMap<AssetId, ArrayBuffer>): Promise<boolean> {
  const text = serializeProjectFile(project, assetData);
  const suggestedName = projectFileName(project);
  const files = getHostFiles();
  if (files) return (await files.saveFile({ suggestedName, data: text })) !== null;

  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url); // a transient trigger for the browser's save, not something kept
  return true;
}

/** Asks for a project file and reads it. Resolves null if the user cancelled; throws an Error fit to show the user if
 * the file is not one we can open. */
export async function importProjectFile(): Promise<ProjectFileResult | null> {
  const text = await pickFileText();
  return text === null ? null : parseProjectFile(text);
}

async function pickFileText(): Promise<string | null> {
  const files = getHostFiles();
  if (files) {
    const picked = await files.openFile({ extensions: ["json"] });
    return picked ? new TextDecoder().decode(picked.data) : null;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.json,.${PROJECT_FILE_EXTENSION},application/json`;
    // Attached while the dialog is open: some browsers only honour a file input that is in the document.
    input.style.display = "none";
    document.body.appendChild(input);
    const done = () => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      done();
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    });
    input.addEventListener("cancel", () => {
      done();
      resolve(null);
    });
    input.click();
  });
}
