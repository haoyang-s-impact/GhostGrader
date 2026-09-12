import { describe, expect, it } from "vitest";
import { createCanvasAdapter } from "../src/lms/canvas";
import { selectLmsAdapter } from "../src/lms/select";

describe("Canvas adapter stub", () => {
  it("fails loudly and without retrying rather than pretending to work", async () => {
    const canvas = createCanvasAdapter({ baseUrl: "https://school.instructure.com/api/v1", token: "t" });
    expect(canvas.name).toBe("canvas");
    await expect(canvas.listAssignments()).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/not implemented/) });
  });
});

describe("selectLmsAdapter", () => {
  it("has no LMS by default and returns the Canvas adapter on request", () => {
    expect(selectLmsAdapter({})).toBeNull();
    expect(selectLmsAdapter({ GG_LMS: "canvas" })?.name).toBe("canvas");
  });
});
