import type { Referral } from "../types";

/** Future server integration boundary. Never place a Claude API key in the browser. */
export interface AnalysisProvider {
  analyze(
    files: File[],
    onSnapshot: (snapshot: Referral) => void,
    signal?: AbortSignal,
  ): Promise<Referral>;
}

/** Deliberately unimplemented: this task establishes the frontend only. */
export const pendingClaudeProvider: AnalysisProvider = {
  async analyze() {
    throw new Error("Claude document analysis is not connected yet.");
  },
};
