import { describe, expect, it } from "vitest";
import { MatrixIn, MatrixOut } from "webdsp";
import { INSTRUMENT_DEFS } from "../src/model/instruments";
import {
  MATRIX_COLUMN_GROUPS, MATRIX_ROW_GROUPS, amountFromDrag, cellId, cellOfId, defaultAmount, describePatch, findPatch, formatAmount,
  kindOf, readPatches, readoutText, snapAmount, swingText, wouldBeFeedback,
} from "../src/model/patchMatrixView";

const def = INSTRUMENT_DEFS.matrix;
const cellDefault = (id: string) => def.params.find((p) => p.id === id)?.default ?? 0;
const patchesOf = (params: Record<string, number>) => readPatches(params, cellDefault);

describe("patch matrix cells", () => {
  it("names every cell like the engine and INSTRUMENT_DEFS do", () => {
    expect(cellId(MatrixOut.Lfo1, MatrixIn.Cutoff)).toBe("lfo1_cutoff");
    expect(cellId(MatrixOut.Vcf, MatrixIn.Pitch)).toBe("vcf_pitch");
    expect(cellId(MatrixOut.Vco, MatrixIn.VcfIn)).toBe("vco_vcfin");
    const cells = def.params.filter((p) => p.cell);
    expect(cells).toHaveLength(88);
    for (const p of cells) {
      expect(cellId(p.cell!.out, p.cell!.input)).toBe(p.id);
      expect(cellOfId(p.id)).toEqual({ out: p.cell!.out, input: p.cell!.input });
    }
    expect(def.params.filter((p) => !p.cell && p.id !== "gain")).toHaveLength(21);   // the modules' knobs, drawn as sliders
    expect(cellOfId("cutoff")).toBeNull();
  });

  it("lays the grid out as a patch bay: every out a column, every in a row, once", () => {
    expect(MATRIX_COLUMN_GROUPS.map((g) => g.label)).toEqual(["Audio outs", "Control outs"]);
    expect(MATRIX_COLUMN_GROUPS.flatMap((g) => g.outs).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(MATRIX_ROW_GROUPS.map((g) => g.label)).toEqual(["VCO", "VCF", "VCA", "LFO", "Output"]);
    expect(MATRIX_ROW_GROUPS.flatMap((g) => g.ins)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // down the audio path
  });
});

describe("reading cables from params", () => {
  it("falls back to the catalog defaults: the default patch is the ordinary voice", () => {
    expect(patchesOf({}).map((p) => cellId(p.out, p.input))).toEqual(["vco_vcfin", "env1_level", "env2_cutoff", "vcf_vcain", "vca_out"]);
  });

  it("uses stored values over defaults, and a stored 0 removes a cable, the audio path included", () => {
    const patches = patchesOf({ vca_out: 0, vcf_cutoff: -0.3, lfo1_pitch: 0.05 });
    expect(findPatch(patches, MatrixOut.Vca, MatrixIn.Out)).toBeUndefined();
    expect(findPatch(patches, MatrixOut.Vcf, MatrixIn.Cutoff)?.amount).toBe(-0.3);
    expect(findPatch(patches, MatrixOut.Lfo1, MatrixIn.Pitch)?.amount).toBe(0.05);
  });
});

describe("feedback and descriptions", () => {
  it("knows a loop when it sees one, before and after it is made", () => {
    const none = patchesOf({});
    expect(wouldBeFeedback(MatrixOut.Vcf, MatrixIn.Cutoff, none)).toBe(true);
    expect(wouldBeFeedback(MatrixOut.Vcf, MatrixIn.VcfIn, none)).toBe(true);
    expect(wouldBeFeedback(MatrixOut.Lfo1, MatrixIn.Cutoff, none)).toBe(false);
    expect(wouldBeFeedback(MatrixOut.Vco, MatrixIn.VcaIn, none)).toBe(false);   // skipping the filter is no loop
    expect(wouldBeFeedback(MatrixOut.Vco, MatrixIn.VcfIn, none)).toBe(false);   // an existing cable is judged without itself
    const looped = patchesOf({ vcf_cutoff: 0.5 });
    expect(kindOf(MatrixOut.Vcf, MatrixIn.Cutoff, 0.5, looped)).toBe("feedback");
    expect(kindOf(MatrixOut.Lfo1, MatrixIn.Cutoff, 0.5, looped)).toBe("control");
    expect(kindOf(MatrixOut.Vco, MatrixIn.VcfIn, 1, looped)).toBe("audio");
  });

  it("describes a cable in plain words, with where it goes and the loop it closes", () => {
    const patches = patchesOf({ vcf_cutoff: 0.58, vcf_pitch: 0.2 });
    const growl = describePatch(MatrixOut.Vcf, MatrixIn.Cutoff, 0.58, patches);
    expect(growl).toMatchObject({ kind: "feedback", title: "VCF → VCF cutoff", name: "Growl", loop: ["VCF", "VCF"] });
    expect(growl.path).toEqual(["VCF", "VCF cutoff", "VCA", "Out"]);
    const scream = describePatch(MatrixOut.Vcf, MatrixIn.Pitch, 0.2, patches);
    expect(scream.loop).toEqual(["VCF", "VCO", "VCF"]);
    expect(scream.name).toBe("Scream");
    expect(describePatch(MatrixOut.Lfo1, MatrixIn.Cutoff, 0.4, patches)).toMatchObject({ kind: "control", name: "Wobble", loop: null });
    expect(describePatch(MatrixOut.Env2, MatrixIn.Cutoff, 0.4, patches).name).toBe("Filter sweep");
    // The audio path is cables with names too.
    expect(describePatch(MatrixOut.Vco, MatrixIn.VcfIn, 1, patchesOf({})).name).toBe("Oscillator into the filter");
    expect(describePatch(MatrixOut.Vco, MatrixIn.VcaIn, 1, patchesOf({})).name).toBe("Skip the filter");
    expect(describePatch(MatrixOut.Vcf, MatrixIn.VcfIn, 0.4, patchesOf({})).name).toBe("Filter into itself");
  });

  it("says when a cable goes nowhere you can hear", () => {
    const noOutput = patchesOf({ vca_out: 0 });
    expect(describePatch(MatrixOut.Lfo1, MatrixIn.Cutoff, 0.5, noOutput).path).toBeNull();
    // A cable that is itself the link to the output counts.
    expect(describePatch(MatrixOut.Vca, MatrixIn.Out, 1, noOutput).path).toEqual(["VCA", "Output"]);
    expect(describePatch(MatrixOut.Lfo1, MatrixIn.Cutoff, 0.5, patchesOf({})).path).toEqual(["LFO 1", "VCF cutoff", "VCA", "Out"]);
  });

  it("says how far a cable moves a control in, or what level an audio in gets", () => {
    expect(swingText(MatrixIn.Cutoff, 0.5)).toBe("+2.5 oct");
    expect(swingText(MatrixIn.Cutoff, -1)).toBe("−5.0 oct");
    expect(swingText(MatrixIn.Pitch, 0.25)).toBe("+3.0 st");
    expect(swingText(MatrixIn.Level, 1)).toBe("+100%");
    expect(swingText(MatrixIn.Lfo1Rate, 0.667)).toBe("+2.0 oct");
    expect(swingText(MatrixIn.VcfIn, 1)).toBeNull();
    expect(readoutText(MatrixOut.Noise, MatrixIn.VcfIn, 0.5)).toBe("Mixes Noise into VCF in at 50% of its level. Cables into the same in add.");
    expect(readoutText(MatrixOut.Lfo1, MatrixIn.Cutoff, 0.5)).toContain("+2.5 oct");
  });
});

describe("gestures", () => {
  it("snaps to round values and clamps to the cell's range", () => {
    expect(snapAmount(0.02)).toBe(0);
    expect(snapAmount(0.49)).toBe(0.5);
    expect(snapAmount(-0.98)).toBe(-1);
    expect(snapAmount(0.337)).toBe(0.34);
    expect(snapAmount(7)).toBe(1);
    expect(Object.is(snapAmount(-0.001), 0)).toBe(true);   // never -0
  });

  it("drags a cell: a cell's width is about 100% of mix", () => {
    expect(amountFromDrag(0.5, 0, 100)).toBe(0.5);
    expect(amountFromDrag(0, 80, 100)).toBe(1);
    expect(amountFromDrag(0.5, -80, 100)).toBe(-0.5);
    expect(amountFromDrag(0.5, 400, 100)).toBe(1);
  });

  it("starts an audio cable at unity, the amp level fully open, anything else at half", () => {
    expect(defaultAmount(MatrixIn.Cutoff)).toBe(0.5);
    expect(defaultAmount(MatrixIn.Level)).toBe(1);
    expect(defaultAmount(MatrixIn.VcaIn)).toBe(1);
    expect(defaultAmount(MatrixIn.Out)).toBe(1);
    expect(formatAmount(0.55)).toBe("+55%");
    expect(formatAmount(-0.4)).toBe("−40%");
    expect(formatAmount(0)).toBe("0%");
  });
});
