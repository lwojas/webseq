import type { AudioModule } from "../modules/types";
import { ModulePanel } from "./ModulePanel";

interface Props {
  modules: AudioModule[];
}

export function ModuleStrip({ modules }: Props) {
  return (
    <div className="module-strip">
      <div className="module-strip-title">Modules — Master Output Chain</div>
      <div className="modules">
        {modules.map((m) => (
          <ModulePanel key={m.id} module={m} />
        ))}
      </div>
    </div>
  );
}
