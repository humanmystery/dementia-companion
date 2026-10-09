import "server-only";

const BANNED: RegExp[] = [
  /\bdo you remember\b/i,
  /\bdon'?t you remember\b/i,
  /\bcan you remember\b/i,
  /\bremember (when|who|what|where)\b/i,
  /\bwho is (this|that|she|he)\b/i,
  /\bwho'?s (this|that)\b/i,
  /\bwhat year\b/i,
  /\bwhat did you do\b/i,
  /\bcan you tell me (who|what|where|when)\b/i,
  /\byou forgot\b/i,
  /\byou'?ve forgotten\b/i,
  /\byou are confused\b/i,
  /\byou'?re confused\b/i,
  /\bthat'?s (not right|wrong)\b/i,
  /\bactually,? (it|that) was\b/i,
  /\b(dose|dosage|mg|milligram)\b/i,
];

const PRESENT_VERBS = "is|loves|likes|lives|has|comes|visits|calls|will|wants|enjoys|is coming|can";

export type GuardContext = {
  /** Names the output is allowed to use (face labels + names that appear in the carer note). */
  allowedNames: string[];
  /** All enrolled names in the household. Using one not in allowedNames is a violation. */
  enrolledNames: string[];
  deceasedNames: string[];
};

export function checkText(text: string, ctx: GuardContext): string[] {
  const problems: string[] = [];
  for (const re of BANNED) if (re.test(text)) problems.push(`banned phrase: ${re.source}`);

  const allowed = new Set(ctx.allowedNames.map((n) => n.toLowerCase()));
  for (const name of ctx.enrolledNames) {
    if (allowed.has(name.toLowerCase())) continue;
    if (new RegExp(`\\b${escape(name)}\\b`, "i").test(text)) problems.push(`names someone not in the facts: ${name}`);
  }

  for (const name of ctx.deceasedNames) {
    const re = new RegExp(`\\b${escape(name)}\\s+(${PRESENT_VERBS})\\b`, "i");
    if (re.test(text)) problems.push(`present tense for someone who has died: ${name}`);
    if (new RegExp(`\\b(call|visit|see) ${escape(name)}\\b`, "i").test(text) && /\b(will|soon|today|tomorrow|could)\b/i.test(text)) {
      problems.push(`suggests ${name} is reachable`);
    }
  }
  return problems;
}

export function namesInNote(note: string | undefined, enrolledNames: string[]): string[] {
  if (!note) return [];
  return enrolledNames.filter((n) => new RegExp(`\\b${escape(n)}\\b`, "i").test(note));
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate, check, retry once with the problems fed back, then fall back to a safe line.
 */
export async function guarded<T>(
  generate: (feedback?: string) => Promise<T>,
  texts: (out: T) => string[],
  ctx: GuardContext,
  fallback: () => T,
): Promise<{ value: T; usedFallback: boolean; problems: string[] }> {
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await generate(
        attempt === 0
          ? undefined
          : `Your previous answer broke these rules: ${lastProblems.join("; ")}. Rewrite it following the rules exactly.`,
      );
      lastProblems = texts(out).flatMap((t) => checkText(t, ctx));
      if (!lastProblems.length) return { value: out, usedFallback: false, problems: [] };
    } catch (e) {
      lastProblems = [`generation failed: ${(e as Error).message}`];
    }
  }
  return { value: fallback(), usedFallback: true, problems: lastProblems };
}
