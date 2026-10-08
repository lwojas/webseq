import { describe, expect, it } from "vitest";
import { describeThrown } from "../src/midi/useMidiControls";

// ECS-132: surface.attach() can reject with a SurfaceError -- a plain {code, message} object, not an
// Error instance -- which used to reach the panel as the unhelpful String(err) result "[object Object]".
describe("describeThrown", () => {
  it("reads the message off an Error instance", () => {
    expect(describeThrown(new Error("boom"))).toBe("boom");
  });

  it("reads the message off a plain SurfaceError-shaped object", () => {
    expect(describeThrown({ code: "port-unavailable", message: "Required port \"user-port-out\" was not supplied." })).toBe(
      'Required port "user-port-out" was not supplied.',
    );
  });

  it("falls back to String() for anything else", () => {
    expect(describeThrown("already a string")).toBe("already a string");
    expect(describeThrown(42)).toBe("42");
  });
});
