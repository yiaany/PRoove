/**
 * tests/model.test.ts
 *
 * Tests the model adapter with a mock response (no real API calls).
 */

import { describe, it, expect } from "vitest";
import { askModel } from "../bot/model.js";

describe("askModel — mock injection", () => {
  it("returns the mock response directly when injected", async () => {
    const mock = {
      suspectedBug: "test bug",
      specRule: "test rule",
      testCode: "it('test', () => {})",
    };
    const result = await askModel("spec", "diff", mock);
    expect(result).toEqual(mock);
  });

  it("returns null when mock is null (no candidate)", async () => {
    const result = await askModel("spec", "diff", null);
    expect(result).toBeNull();
  });

  it("throws when env vars missing and no mock", async () => {
    // Temporarily clear env vars to test error path
    const saved = {
      url: process.env.OPENAI_COMPAT_BASE_URL,
      key: process.env.OPENAI_COMPAT_API_KEY,
      model: process.env.OPENAI_COMPAT_MODEL,
    };
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_API_KEY;
    delete process.env.OPENAI_COMPAT_MODEL;

    try {
      await expect(askModel("spec", "diff")).rejects.toThrow(
        "Missing required environment variables",
      );
    } finally {
      if (saved.url) process.env.OPENAI_COMPAT_BASE_URL = saved.url;
      if (saved.key) process.env.OPENAI_COMPAT_API_KEY = saved.key;
      if (saved.model) process.env.OPENAI_COMPAT_MODEL = saved.model;
    }
  });
});
