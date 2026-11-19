import { describe, expect, it } from "vitest";
import { normalizeMeetingUrl, safeMeetingUrl } from "@/lib/meeting-url";
import { isTaskOverdue } from "@/lib/task-dates";

describe("project meeting links", () => {
  it("accepts booking links and clears an empty value", () => {
    expect(normalizeMeetingUrl(" https://calendly.com/spacenez/design-review ")).toBe("https://calendly.com/spacenez/design-review");
    expect(normalizeMeetingUrl("")).toBeNull();
    expect(normalizeMeetingUrl("https://team.calendly.com/review")).toBe("https://team.calendly.com/review");
  });
  it.each([
    "javascript:alert(1)", "http://calendly.com/review", "https://calendly.com.evil.test/review",
    "https://calendly.com@evil.test/review", "https://user@calendly.com/review",
    "https://calendly.com:8443/review", "https://calendly.com/", "https://calendly.com/a\nb",
  ])("rejects an unsafe or incomplete destination: %s", (input) => {
    expect(() => normalizeMeetingUrl(input)).toThrow();
    expect(safeMeetingUrl(input)).toBeNull();
  });
});

describe("task calendar deadlines", () => {
  const now = new Date(2026, 10, 19, 18, 30);
  it("does not count today's deadline as overdue", () => {
    expect(isTaskOverdue({ status: "in_progress", due_date: "2026-11-19" }, now)).toBe(false);
    expect(isTaskOverdue({ status: "not_started", due_date: "2026-11-18" }, now)).toBe(true);
    expect(isTaskOverdue({ status: "done", due_date: "2026-11-18" }, now)).toBe(false);
  });
  it("handles undated and invalid deadlines without flagging them", () => {
    expect(isTaskOverdue({ status: "not_started", due_date: null }, now)).toBe(false);
    expect(isTaskOverdue({ status: "not_started", due_date: "bad-date" }, now)).toBe(false);
  });
});
