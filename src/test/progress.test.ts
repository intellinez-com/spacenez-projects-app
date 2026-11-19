import { describe, expect, it } from "vitest";
import { progressOf } from "@/lib/constants";

describe("project progress", () => {
  it("is the share of done tasks, rounded", () => {
    expect(progressOf([{ status: "done" }, { status: "in_progress" }, { status: "not_started" }])).toBe(33);
  });
  it("is 0 when a project has no tasks", () => {
    expect(progressOf([])).toBe(0);
  });
});
