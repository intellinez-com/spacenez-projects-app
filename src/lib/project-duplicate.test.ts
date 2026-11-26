import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDuplicateProjectRequest, clearPendingDuplicate, defaultDuplicateProjectFields,
  duplicateProjectFieldsSchema, keepPendingDuplicate, readPendingDuplicate,
} from "./project-duplicate";

const sourceId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const actorId = "30000000-0000-4000-8000-000000000001";
beforeEach(() => sessionStorage.clear());

describe("duplicate project details", () => {
  it("starts with fresh client/site/details and only reuses a recognised space type", () => {
    const source = { id: sourceId, name: "Old client project", project_type: "Restaurant / Café", client_name: "Old client", client_email: "old@example.test", description: "Old client-specific notes" };
    expect(defaultDuplicateProjectFields(source)).toEqual({
      name: "", client_name: "", client_brand: "", client_email: "", location: "", description: "", project_type: "Restaurant / Café",
    });
    expect(defaultDuplicateProjectFields({ id: sourceId, name: "Source", project_type: "Unknown" }).project_type).toBe("Other");
  });

  it("validates the new project and never accepts copied statuses, accounts or dates", () => {
    const fields = { ...defaultDuplicateProjectFields({ id: sourceId, name: "Source" }), name: "  New cafe  " };
    expect(buildDuplicateProjectRequest(sourceId, requestId, fields)).toEqual({ p_source_project_id: sourceId, p_request_id: requestId, p_project: { ...fields, name: "New cafe" } });
    expect(duplicateProjectFieldsSchema.safeParse({ ...fields, name: " " }).success).toBe(false);
    expect(duplicateProjectFieldsSchema.safeParse({ ...fields, client_email: "bad-email" }).success).toBe(false);
    expect(duplicateProjectFieldsSchema.safeParse({ ...fields, status: "done" }).success).toBe(false);
    expect(duplicateProjectFieldsSchema.safeParse({ ...fields, start_date: "2026-11-25" }).success).toBe(false);
  });

  it("keeps an unfinished request scoped to its account and source across remounts", () => {
    const request = buildDuplicateProjectRequest(sourceId, requestId, { ...defaultDuplicateProjectFields({ id: sourceId, name: "Source" }), name: "New project" });
    keepPendingDuplicate(actorId, request);
    expect(readPendingDuplicate(actorId, sourceId)).toEqual(request);
    expect(readPendingDuplicate("different-account", sourceId)).toBeNull();
    expect(readPendingDuplicate(actorId, "10000000-0000-4000-8000-000000000002")).toBeNull();
    clearPendingDuplicate(actorId, sourceId);
    expect(readPendingDuplicate(actorId, sourceId)).toBeNull();
  });
});
