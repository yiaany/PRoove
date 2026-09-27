/**
 * model.ts — LLM adapter for OpenAI-compatible Chat Completions API.
 *
 * Reads provider settings exclusively from environment variables:
 *   OPENAI_COMPAT_BASE_URL  e.g. https://api.openai.com/v1
 *   OPENAI_COMPAT_API_KEY   secret key
 *   OPENAI_COMPAT_MODEL     e.g. gpt-4o
 *
 * Returns a structured candidate: one suspected regression + one Vitest test.
 */

import OpenAI from "openai";
import { z } from "zod";

export interface ModelCandidate {
  suspectedBug: string;
  specRule: string;
  testCode: string; // a complete Vitest test file (TypeScript)
}

const CandidateSchema = z.object({
  suspectedBug: z.string().min(1),
  specRule: z.string().min(1),
  testCode: z.string().min(1),
});

const SYSTEM_PROMPT = `You are a senior engineer reviewing a GitHub pull request.
You will receive:
1. A behavior specification (SPEC.md) describing expected rules.
2. A unified diff of the PR.

Your task:
- Identify AT MOST ONE likely regression introduced by the diff.
- Propose exactly ONE new Vitest regression test (TypeScript) that:
  * imports the changed function using a RELATIVE path like "../src/checkout.js" (Node ESM)
  * should PASS on the base revision (correct behavior)
  * should FAIL on the head revision (regression)
  * is self-contained (no network, no external fixtures)

Reply ONLY with valid JSON matching this schema (no markdown fences, no extra text):
{
  "suspectedBug": "<one-sentence description of the suspected regression>",
  "specRule": "<the exact SPEC rule being violated, quoted from SPEC.md>",
  "testCode": "<complete Vitest test file content as a string>"
}

If you cannot identify a regression, reply:
{"suspectedBug":"","specRule":"","testCode":""}`;

export async function askModel(
  spec: string,
  diff: string,
  mockResponse?: ModelCandidate | null,
): Promise<ModelCandidate | null> {
  // In demo mode a mock response is injected directly (no API call)
  if (mockResponse !== undefined) {
    return mockResponse;
  }

  const baseUrl = process.env.OPENAI_COMPAT_BASE_URL;
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;
  const model = process.env.OPENAI_COMPAT_MODEL;

  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      "Missing required environment variables: OPENAI_COMPAT_BASE_URL, OPENAI_COMPAT_API_KEY, OPENAI_COMPAT_MODEL",
    );
  }

  const client = new OpenAI({ baseURL: baseUrl, apiKey });

  const userContent = `## SPEC.md\n\n${spec}\n\n## Diff\n\n\`\`\`diff\n${diff}\n\`\`\``;

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });
    raw = response.choices[0]?.message?.content ?? "";
  } catch (err: unknown) {
    throw new Error(`Model API call failed: ${String(err)}`);
  }

  // Strip optional markdown fences the model may add despite instructions
  const cleaned = raw.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Model returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const result = CandidateSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Model response schema mismatch: ${result.error.message}\nRaw: ${raw.slice(0, 200)}`,
    );
  }

  const candidate = result.data;
  if (!candidate.suspectedBug) {
    return null; // model found no regression
  }
  return candidate;
}
