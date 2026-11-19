import { describe, expect, it } from "vitest";
import { buildProjectImport, defaultImportProject, parseProjectImport } from "@/lib/project-import";
import { projectImportFixture } from "./project-import-fixture";

describe("Project plan import", () => {
  it("preserves ambiguous source dates and planned records without inventing decisions or owners", () => {
    const plan = parseProjectImport(JSON.stringify(projectImportFixture()), "example");
    const payload = buildProjectImport(plan, defaultImportProject(plan));
    expect(payload.p_tasks).toHaveLength(1);
    expect(payload.p_tasks[0]).toMatchObject({ source_id: "07", start_date: null, status: "not_started", description: "Client chooses a layout", source_metadata: { original: { start_date: "same day" } } });
    expect(payload.p_tasks[0]).not.toHaveProperty("assignee_id");
    expect(payload.p_approval_plan[0]).toMatchObject({ task_source_id: "07", milestone: "Layout sign-off", source_metadata: { original: { client_response: "Pending", signoff_date: null } } });
    expect(payload.p_approval_plan[0]).not.toHaveProperty("decision");
    expect(payload.p_project.description).toContain("Three options included");
    expect(payload.p_project.description).toContain("Notes from project plan:");
    expect(payload.p_project.description).not.toContain("example.xlsx");
    expect(payload.p_project.description).not.toContain("SHA-256");
    expect(payload.p_project.description).not.toContain("Overview!A1");
    expect(payload.p_project.description).not.toContain("No additional task invented");
    expect(payload.p_project.start_date).toBeNull();
    expect(payload.p_source_sha256).toBe("a".repeat(64));
  });

  it("keeps the source hash stable across JSON formatting and repeated preparation", () => {
    const source = projectImportFixture();
    const first = parseProjectImport(JSON.stringify(source), "example");
    const second = parseProjectImport(JSON.stringify(source, null, 2), "example");
    expect(buildProjectImport(first, defaultImportProject(first))).toEqual(buildProjectImport(second, defaultImportProject(second)));
  });

  it("rejects duplicate IDs, missing approval references, and invented dates", () => {
    const duplicate = projectImportFixture();
    duplicate.tasks.push(duplicate.tasks[0]!);
    expect(() => parseProjectImport(JSON.stringify(duplicate), "example")).toThrow("Duplicate source task ID");
    const missing = projectImportFixture();
    missing.planned_approval_records[0]!.related_task_source_id = "missing";
    expect(() => parseProjectImport(JSON.stringify(missing), "example")).toThrow("missing task");
    const inventedDate = projectImportFixture();
    inventedDate.tasks[0]!.proposed_task.start_date = "2026-11-21";
    expect(() => parseProjectImport(JSON.stringify(inventedDate), "example")).toThrow("Dates must preserve");
  });

  it("rejects unsupported fields, fabricated completion, invalid dates and unsafe meeting links", () => {
    expect(() => parseProjectImport(JSON.stringify({ ...projectImportFixture(), extra: "instructions" }), "example")).toThrow("Unrecognized key");
    const completed = projectImportFixture();
    completed.tasks[0]!.proposed_task.status = "done";
    expect(() => parseProjectImport(JSON.stringify(completed), "example")).toThrow("not_started");
    const plan = parseProjectImport(JSON.stringify(projectImportFixture()), "example");
    expect(() => buildProjectImport(plan, { ...defaultImportProject(plan), start_date: "2026-02-30" })).toThrow();
    expect(() => buildProjectImport(plan, { ...defaultImportProject(plan), meeting_url: "https://calendly.com.attacker.example/book" })).toThrow();
  });

  it("requires explicit migration review to accept a different backend", () => {
    const json = JSON.stringify(projectImportFixture());
    expect(() => parseProjectImport(json, "newbackend")).toThrow("different backend");
    expect(parseProjectImport(json, "newbackend", true).target_backend_ref).toBe("example");
  });
});
