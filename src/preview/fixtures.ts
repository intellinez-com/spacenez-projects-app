import type { Database } from "@/integrations/supabase/types";

type Row<Table extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][Table]["Row"];
export const previewIds = {
  project: "11111111-1111-4111-8111-111111111111",
  client: "22222222-2222-4222-8222-222222222222",
  designer: "33333333-3333-4333-8333-333333333333",
  reviewTask: "44444444-4444-4444-8444-444444444443",
};

function day(offset: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function timestamp(offset: number, hour = 9) { return `${day(offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`; }

export function createPreviewFixtures() {
  const profiles: Row<"profiles">[] = [
    { id: previewIds.client, full_name: "Sample Client", email: "client@example.test", company: "Sample Client Brand", created_at: timestamp(-20) },
    { id: previewIds.designer, full_name: "Sample Designer", email: "designer@example.test", company: "Sample Design Team", created_at: timestamp(-20) },
  ];
  const projects: Row<"projects">[] = [{
    id: previewIds.project, name: "Sample interior project", client_name: "Sample Client", client_brand: "Sample Client Brand", client_email: "client@example.test",
    location: "Sample site", project_type: "Apartment", current_stage: "layout_2d", status: "active", start_date: day(-14), target_date: day(45),
    description: "Sample project for reviewing the client experience. These dates, progress updates and files are fictional.", meeting_url: null,
    created_at: timestamp(-20), created_by: previewIds.designer,
  }];
  const taskInputs = [
    ["Project brief and requirements", "planning", "done", -14, -12],
    ["Site measurements", "site_survey", "done", -12, -10],
    ["Review the furniture layout", "layout_2d", "review", -3, 2],
    ["Confirm kitchen dimensions", "layout_2d", "in_progress", -3, -1],
    ["Choose colours and materials", "interior_design", "not_started", 4, 10],
    ["Prepare living room visuals", "design_3d", "not_started", 5, 15],
    ["Confirm lighting preferences", "interior_design", "blocked", 1, 7],
    ["Final handover inspection", "handover", "not_started", null, null],
  ] as const;
  const tasks: Row<"tasks">[] = taskInputs.map(([title, stage, status, start, due], index) => ({
    id: `44444444-4444-4444-8444-${String(444444444441 + index)}`, project_id: previewIds.project, title, stage, status,
    description: index === 2 ? "Please review the sample layout document and confirm the furniture positions. You can approve it or request changes below." : "Sample task description for the local client preview.",
    priority: index === 3 ? "high" : "medium", position: index, start_date: start === null ? null : day(start), due_date: due === null ? null : day(due),
    assignee_id: previewIds.designer, created_by: previewIds.designer, created_at: timestamp(-14), updated_at: timestamp(-1), content_revision: 1,
    source_id: null, source_metadata: {},
  }));
  const project_members: Row<"project_members">[] = [
    { id: "55555555-5555-4555-8555-555555555551", project_id: previewIds.project, user_id: previewIds.client, access: "client", created_at: timestamp(-20) },
    { id: "55555555-5555-4555-8555-555555555552", project_id: previewIds.project, user_id: previewIds.designer, access: "partner", created_at: timestamp(-20) },
  ];
  const documents: Row<"documents">[] = [
    { id: "66666666-6666-4666-8666-666666666661", project_id: previewIds.project, task_id: previewIds.reviewTask, name: "Sample layout notes.txt", path: `${previewIds.project}/sample-document.txt`, size: 500, uploaded_by: previewIds.designer, created_at: timestamp(-1) },
    { id: "66666666-6666-4666-8666-666666666662", project_id: previewIds.project, task_id: null, name: "Sample room illustration.png", path: `${previewIds.project}/sample-room.png`, size: 1000, uploaded_by: previewIds.designer, created_at: timestamp(-1, 10) },
  ];
  const comments: Row<"comments">[] = [
    { id: "77777777-7777-4777-8777-777777777771", project_id: previewIds.project, task_id: null, user_id: previewIds.designer, body: "The site measurements are complete. The furniture layout is ready for your review. Open Approvals to share your decision.", created_at: timestamp(-1, 10) },
    { id: "77777777-7777-4777-8777-777777777772", project_id: previewIds.project, task_id: previewIds.reviewTask, user_id: previewIds.designer, body: "Please check the walkway and sofa positions in the attached sample notes.", created_at: timestamp(-1, 9) },
    { id: "77777777-7777-4777-8777-777777777773", project_id: previewIds.project, task_id: null, user_id: previewIds.client, body: "Thank you. I will review the layout and share my feedback here.", created_at: timestamp(-1, 11) },
  ];
  const project_daily_updates: Row<"project_daily_updates">[] = [
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", project_id: previewIds.project, report_date: day(0), work_done: "Reviewed the furniture layout and confirmed the kitchen measurements. The revised drawing is ready for review.", next_steps: "Confirm the sofa position, then prepare the living room visuals.", blockers: "Lighting preferences are awaiting your confirmation.", created_by: previewIds.designer, created_at: new Date().toISOString() },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", project_id: previewIds.project, report_date: day(-1), work_done: "Completed the site measurements and shared the room photos.", next_steps: "Revise the furniture layout using the measurements.", blockers: "", created_by: previewIds.designer, created_at: timestamp(-1, 10) },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", project_id: previewIds.project, report_date: day(-9), work_done: "Agreed the project brief and recorded the room requirements.", next_steps: "Schedule the site survey.", blockers: "", created_by: previewIds.designer, created_at: timestamp(-9, 10) },
  ];
  const reviewTask = tasks.find((task) => task.id === previewIds.reviewTask)!;
  const task_approvals: Row<"task_approvals">[] = [{
    id: "88888888-8888-4888-8888-888888888881", project_id: previewIds.project, task_id: previewIds.reviewTask, revision: 1,
    state: "pending", requested_by: previewIds.designer, requested_at: timestamp(-1), decided_by: null, decided_at: null, feedback: null,
    snapshot: { version: 1, task: { id: reviewTask.id, title: reviewTask.title, description: reviewTask.description, stage: reviewTask.stage, content_revision: 1 }, documents: documents.filter((document) => document.task_id === reviewTask.id) },
  }];
  const task_approval_plan: Row<"task_approval_plan">[] = [{
    id: "99999999-9999-4999-8999-999999999991", project_id: previewIds.project, task_id: previewIds.reviewTask,
    source_id: "sample-layout-review", stage_gate: "2D Layout", milestone: "Furniture layout", description: "Confirm the furniture positions before visuals begin.", source_metadata: {}, created_at: timestamp(-14),
  }];
  return { profiles, projects, tasks, project_members, documents, comments, project_daily_updates, task_approvals, task_approval_plan, user_roles: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: previewIds.client, role: "client" }] };
}
