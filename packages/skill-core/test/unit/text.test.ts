import { expect, test } from "bun:test";

import { decodeStrictText } from "../../src/content/text";
import { SkctlError } from "../../src/shared";

test("decodes UTF-8 strictly at the exact one MiB boundary", () => {
  expect(decodeStrictText(new Uint8Array(1_048_576).fill(65))).toHaveLength(1_048_576);
  expect(() => decodeStrictText(new Uint8Array(1_048_577))).toThrow(SkctlError);
  expect(() => decodeStrictText(new Uint8Array([0xc3, 0x28]))).toThrow(SkctlError);
});
