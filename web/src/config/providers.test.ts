import { describe, expect, it } from "vitest";
import { providerDefinition, providerOptions } from "./providers";

describe("厂商目录", () => {
  it("包含 eRPC 当前注册的 24 个厂商", () => {
    expect(providerOptions().map((item) => item.value)).toEqual([
      "goldsky", "alchemy", "blastapi", "conduit", "drpc", "dwellir",
      "envio", "etherspot", "infura", "pimlico", "quicknode", "llama",
      "thirdweb", "repository", "superchain", "tenderly", "chainstack",
      "onfinality", "erpc", "blockpi", "ankr", "routemesh", "blockdaemon",
      "satelink",
    ]);
  });

  it("未知厂商仍可走开放设置路径", () => {
    expect(providerDefinition("future-vendor")).toMatchObject({
      value: "future-vendor",
      label: "future-vendor",
      fields: [],
    });
  });
});
