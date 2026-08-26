import { describe, expect, it } from "vitest";
import { normalizeValidationResult } from "./api";

describe("validation response boundary", () => {
  it("turns omitted or null report lists into empty arrays", () => {
    expect(normalizeValidationResult({ valid: true, errors: null as never, warnings: null as never, notices: undefined })).toEqual({
      valid: true,
      errors: [],
      warnings: [],
      notices: [],
      report: undefined,
    });
  });
});
