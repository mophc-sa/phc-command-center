import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
/** A readiness result cannot pass by skipping configured security assertions. */
export default class ReadinessReporter implements Reporter {
  private skipped = 0;
  private completed = 0;
  onTestEnd(_test: TestCase, result: TestResult) {
    if (result.status === "skipped") this.skipped++;
    else this.completed++;
  }
  onEnd(result: FullResult): { status: FullResult["status"] } {
    if (this.skipped || !this.completed) {
      console.error(`Readiness incomplete: ${this.skipped} skipped, ${this.completed} executed`);
      return { status: "failed" };
    }
    return { status: result.status };
  }
}
