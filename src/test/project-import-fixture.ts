/** Synthetic data only. Actual client data is selected locally by an admin. */
export function projectImportFixture() {
  return {
    format: "spacenez.project-import-staging.v1", state: "STAGING_ONLY_NOT_IMPORTED",
    source: { filename: "example.xlsx", sha256: "a".repeat(64), sheets: ["Tracker", "Approvals"] },
    target_backend_ref: "example", target_project_id: null,
    project_metadata: { project_name: "Example studio", client_name: "Example client", site_location: "Example city", project_manager: null, kickoff_date: null, project_name_status: "Working title", client_brand: "Example brand", client_email: "client@example.com" },
    tasks: [{ source_id: "07", source_sheet: "Tracker", source_row: 12,
      original: { id: "07", stage: "Concept", title: "Review layout", acceptance_criteria: "Client chooses a layout", responsible: null, start_date: "same day", due_date: null, status: "Not Started", completed_on: null, client_approval: "Not Requested", evidence_link: null, remarks: null },
      proposed_task: { title: "Review layout", description: "Client chooses a layout", stage: "layout_2d", status: "not_started", priority: "medium", assignee_id: null, start_date: null as string | null, due_date: null, position: 0 },
      mapping_notes: ["Calendar date required"],
    }],
    planned_approval_records: [{ source_sheet: "Approvals", source_row: 6, related_task_source_id: "07", original: { stage_gate: "Layout", option_milestone: "Layout sign-off", description: "Choose a layout", shared_on: null, client_response: "Pending", selected: null, signoff_date: null, proof_link: null, remarks: null }, mapping_note: "Planned only" }],
    workbook_workflow_notes: { classification: "Source content", items: [{ source_sheet: "Overview", source_cell: "A1", text: "Three options included" }] },
    overview_material_selection_note: { source_cell: "Overview!A2", text: "Materials", note: "No additional task invented" },
    summary: { tasks: 1, planned_approval_rows: 1, statuses: { "Not Started": 1 }, dated_starts: 0, missing_owners: 1, missing_due_dates: 1 },
    prerequisites: [], defaults: { priority: "Application default", assignee_id: "Unknown" },
    metadata_provenance: { source: "Synthetic test fixture", client_brand: "Supplied", project_name: "Working title", client_name: "Supplied", project_manager: "Missing", kickoff_date: "Missing", task_owners: "Missing" },
    proposed_client_profile: { full_name: "Example client", email: "client@example.com", company: "Example brand", requested_project_access: "client", profile_id: null, state: "Pending" },
  };
}
