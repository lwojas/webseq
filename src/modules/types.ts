// Minimal module abstraction — just enough to hang a real UI off of "a strip of
// processing modules" without building a generic plugin/graph framework. A module owns its
// own parameters and knows how to apply them through webdsp's public API; the module strip
// UI only ever talks to this interface, never to AudioRuntime or a specific module's
// internals directly. Adding a second module (delay, reverb, compressor, EQ...) later means
// implementing one more of these, not touching the strip's rendering code.

export type ModuleParameterKind = "range" | "enum";

export interface ModuleParameterOption {
  label: string;
  value: number;
}

export interface ModuleParameter {
  id: string;
  label: string;
  kind: ModuleParameterKind;
  value: number;
  /** range kind only */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** enum kind only */
  options?: ModuleParameterOption[];
}

export interface AudioModule {
  id: string;
  name: string;
  enabled: boolean;
  parameters: ModuleParameter[];
  setParameter(paramId: string, value: number): void;
  setEnabled(enabled: boolean): void;
}
