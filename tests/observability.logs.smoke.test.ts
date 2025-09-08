import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from "../src/index.js";

const SAMPLE = `{"ts":"2025-01-01T00:00:00.000Z","level":"info","service":"api","message":"ok","userId":1}
{"ts":"2025-01-01T00:00:00.250Z","level":"info","service":"api","message":"ok","userId":2}
{"ts":"2025-01-01T00:00:00.500Z","level":"warn","service":"worker","message":"slow","userId":2}
{"ts":"2025-01-01T00:00:00.750Z","level":"error","service":"api","message":"operation failed due to upstream timeout","userId":3}
`;

describe("observability profile – smoke", () => {
  it("roundtrips and achieves expected savings bounds", async () => {
    const packed = await compressNDJSON(SAMPLE, {
      codec: "hybrid",
      columnar: true,
      // @ts-ignore - profile already supported in your code
      profile: "logs"
    });

    const full = await decompressNDJSON(packed);
    const rawArr = JSON.parse("[" + SAMPLE.trim().split("\n").join(",") + "]");
    const fullArr = JSON.parse("[" + full.trim().split("\n").join(",") + "]");
    expect(fullArr.length).toBe(rawArr.length);

    // Selective decode wins substantially
    const partial = await decompressNDJSON(packed, { fields: ["ts","level","service"] });
    const rawBytes = Buffer.byteLength(SAMPLE, "utf8");
    const packedBytes = packed.byteLength;
    const partialBytes = Buffer.byteLength(partial, "utf8");

    // Soft, portable bounds (don’t make flaky on tiny samples):
    expect(packedBytes).toBeLessThan(rawBytes * 0.90);     // ≤ 90% of raw
    expect(partialBytes).toBeLessThan(rawBytes * 0.80);    // ≤ 80% of raw
  });
});


