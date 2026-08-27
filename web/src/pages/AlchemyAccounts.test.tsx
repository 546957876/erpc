import { describe, expect, it } from "vitest";
import { parseAlchemyPreview } from "./AlchemyAccounts";

describe("Alchemy account preview", () => {
  it("accepts one object, arrays, and NDJSON", () => {
    expect(parseAlchemyPreview('{"email":"one@example.com","api_key":"key"}')).toEqual([{ email: "one@example.com", apiKey: "key" }]);
    expect(parseAlchemyPreview('[{"email":"one@example.com","api_key":"one"},{"email":"two@example.com","api_key":"two"}]')).toHaveLength(2);
    expect(parseAlchemyPreview('{"email":"one@example.com","api_key":"one"}\n{"email":"two@example.com","api_key":"two"}')).toHaveLength(2);
  });

  it("reports structural errors without echoing credentials", () => {
    expect(() => parseAlchemyPreview('{"email":"one@example.com","api_key":"secret-value"}\\nnot-json')).toThrow("JSON 格式无效");
    expect(() => parseAlchemyPreview('{"email":"one@example.com"}')).toThrow("缺少 email 或 api_key");
  });
});
