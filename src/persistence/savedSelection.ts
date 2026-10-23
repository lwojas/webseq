/** Which entry of the saved-projects list should be selected for the project that is open: the entry with the same id, when
 * the open project is one of the saved ones (it was loaded from there, or restored after being loaded or saved). Never overrides a
 * choice that was already made, and never invents one: with nothing to match the selection stays as it was. */
export function preselectSavedProject(current: string, openProjectId: string, saved: readonly { id: string }[]): string {
  if (current !== "") return current;
  return saved.some((p) => p.id === openProjectId) ? openProjectId : current;
}
