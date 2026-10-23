import { describe, expect, it } from "vitest";
import { singleFlight } from "../src/audio/singleFlight";

describe("singleFlight", () => {
  it("callers that arrive while a run is in flight share its result; the run happens once", async () => {
    let runs = 0;
    let release!: (v: string) => void;
    const flight = singleFlight(() => {
      runs++;
      return new Promise<string>((resolve) => (release = resolve));
    });
    const first = flight();
    const second = flight(); // arrives while the first is still running: it must wait, not get nothing back
    release("runtime");
    expect(await first).toBe("runtime");
    expect(await second).toBe("runtime");
    expect(runs).toBe(1);
  });

  it("starts a fresh run after one settles (also after a failure)", async () => {
    let runs = 0;
    const flight = singleFlight(async () => {
      runs++;
      if (runs === 1) throw new Error("first attempt fails");
      return runs;
    });
    await expect(flight()).rejects.toThrow("first attempt fails");
    expect(await flight()).toBe(2);
    expect(await flight()).toBe(3);
  });
});
