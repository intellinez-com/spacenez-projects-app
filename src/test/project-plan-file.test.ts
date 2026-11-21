// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import { buildProjectImport, defaultImportProject } from "@/lib/project-import";
import {
  createProjectPlanTemplate,
  parseProjectPlanFile,
  PROJECT_PLAN_FILE_MAX_BYTES,
} from "@/lib/project-plan-file";

function file(name: string, contents: string | Uint8Array | ArrayBuffer) {
  const bytes =
    typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : contents instanceof ArrayBuffer
        ? new Uint8Array(contents)
        : contents;
  return { name, size: bytes.byteLength, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}
function workbook(
  sheets: { name: string; rows: unknown[][]; edit?: (sheet: xlsx.WorkSheet) => void }[],
) {
  const book = xlsx.utils.book_new();
  for (const entry of sheets) {
    const sheet = xlsx.utils.aoa_to_sheet(entry.rows);
    entry.edit?.(sheet);
    xlsx.utils.book_append_sheet(book, sheet, entry.name);
  }
  return file(
    "Fictional_Studio.xlsx",
    xlsx.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer,
  );
}
const basic =
  "Task ID,Stage,Task,Description,Start date,Due date,Priority,Owner,Approval milestone,Approval description,Notes\r\nT01,Planning & Brief,Review brief,Agree scope,2026-11-21,2026-11-25,High,Site team,Brief sign-off,Confirm scope,Source note\r\n";

describe("spreadsheet project plan import", () => {
  it("reads an Excel-friendly CSV, preserves provenance and builds the existing atomic import payload", async () => {
    const source = file("Fictional_Studio.csv", basic);
    const { plan, warnings, unmappedStages } = await parseProjectPlanFile(source, "example");
    expect(unmappedStages).toEqual([]);
    expect(plan.source.sha256).toBe(createHash("sha256").update(basic).digest("hex"));
    expect(plan.source.filename).toBe("Fictional_Studio.csv");
    expect(plan.tasks[0]).toMatchObject({
      source_id: "T01",
      source_row: 2,
      original: {
        stage: "Planning & Brief",
        title: "Review brief",
        responsible: "Site team",
        remarks: "Source note",
      },
      proposed_task: {
        stage: "planning",
        status: "not_started",
        priority: "high",
        assignee_id: null,
        start_date: "2026-11-21",
        due_date: "2026-11-25",
      },
    });
    expect(warnings.some((text) => text.includes("not assigned automatically"))).toBe(true);
    expect(plan.proposed_client_profile.email).toBeNull();
    const payload = buildProjectImport(plan, defaultImportProject(plan));
    expect(payload.p_source_sha256).toBe(plan.source.sha256);
    expect(payload.p_tasks[0]?.source_metadata).toMatchObject({
      filename: source.name,
      row: 2,
      original: { responsible: "Site team" },
    });
    expect(payload.p_approval_plan[0]).toMatchObject({
      task_source_id: "T01",
      milestone: "Brief sign-off",
    });
  });

  it("handles quotes, commas, multiline descriptions, Unicode and a UTF-8 BOM without changing source content", async () => {
    const { plan } = await parseProjectPlanFile(
      file(
        "unicode.csv",
        '\uFEFFStage,Task,Description\r\nSite Survey,"Measure café, ground floor","Line one\nLine two, included"\r\n',
      ),
      "example",
    );
    expect(plan.tasks[0]?.original.title).toBe("Measure café, ground floor");
    expect(plan.tasks[0]?.original.acceptance_criteria).toBe("Line one\nLine two, included");
    expect(plan.tasks[0]?.proposed_task.stage).toBe("site_survey");
  });

  it("retains physical Excel rows, explicit IDs with leading zeroes, genuine Excel dates and source owner text", async () => {
    const source = workbook([
      {
        name: "Execution Tracker",
        rows: [
          ["Fictional project plan"],
          [],
          [],
          [],
          [
            "ID",
            "Stage",
            "Activity / deliverable",
            "Acceptance criteria / scope",
            "Responsible",
            "Start date",
            "Due date",
            "Status",
            "Completed on",
            "Client approval",
            "Evidence / file link",
            "Remarks / blocker",
          ],
          [
            "07",
            "Site Survey",
            "Measure site",
            "Record dimensions",
            "Survey team",
            new Date("2026-11-21T00:00:00Z"),
            "2026-11-25",
            "Not Started",
            "",
            "Not Requested",
            "https://example.test/reference",
            "Inspect safely",
          ],
        ],
      },
    ]);
    const { plan } = await parseProjectPlanFile(source, "example");
    expect(plan.tasks[0]).toMatchObject({
      source_id: "07",
      source_sheet: "Execution Tracker",
      source_row: 6,
      original: { evidence_link: "https://example.test/reference", responsible: "Survey team" },
      proposed_task: { start_date: "2026-11-21", due_date: "2026-11-25" },
    });
    expect(plan.tasks[0]?.mapping_notes.some((text) => text.includes("Excel date"))).toBe(true);
    expect(plan.workbook_workflow_notes.items).toContainEqual({
      source_sheet: "Execution Tracker",
      source_cell: "A1",
      text: "Fictional project plan",
    });
  });

  it("retains ambiguous dates as text and leaves them undated rather than guessing a locale or kickoff", async () => {
    const { plan, warnings } = await parseProjectPlanFile(
      file(
        "dates.csv",
        "Stage,Task,Start date,Due date\nPlanning & Brief,Review brief,same day,11/12/2026\n",
      ),
      "example",
    );
    expect(plan.tasks[0]).toMatchObject({
      original: { start_date: "same day", due_date: "11/12/2026" },
      proposed_task: { start_date: null, due_date: null },
    });
    expect(warnings.filter((message) => message.includes("calendar date"))).toHaveLength(2);
  });

  it("exposes unknown stage labels for required admin mapping without changing the source label", async () => {
    const { plan, unmappedStages } = await parseProjectPlanFile(
      file("stages.csv", "Stage,Task\nCustom concept,Review one\nCustom concept,Review two\n"),
      "example",
    );
    expect(unmappedStages).toEqual(["Custom concept"]);
    expect(
      plan.tasks.every(
        (task) =>
          task.original.stage === "Custom concept" && task.proposed_task.stage === "planning",
      ),
    ).toBe(true);
    expect(plan.tasks[0]?.mapping_notes.join(" ")).toContain("temporary preview placeholder");
  });

  it("creates deterministic coordinate IDs and fingerprints identical bytes without normalising away source changes", async () => {
    const text = "Stage,Task\nHandover,Check finish\n\nHandover,Hand over keys\n";
    const first = await parseProjectPlanFile(file("same.csv", text), "example");
    const second = await parseProjectPlanFile(file("renamed.csv", text), "example");
    expect(first.plan.tasks.map((task) => task.source_id)).toEqual([
      "sheet-1-row-2",
      "sheet-1-row-4",
    ]);
    expect(second.plan.source.sha256).toBe(first.plan.source.sha256);
    expect(second.plan.tasks.map((task) => task.source_id)).toEqual(
      first.plan.tasks.map((task) => task.source_id),
    );
    const edited = await parseProjectPlanFile(
      file("same.csv", text.replace("Check finish", "Inspect finish")),
      "example",
    );
    expect(edited.plan.source.sha256).not.toBe(first.plan.source.sha256);
  });

  it("links separate planned approvals only by explicit task IDs or unique source-stage matches", async () => {
    const { plan } = await parseProjectPlanFile(
      workbook([
        {
          name: "Tasks",
          rows: [
            ["Task ID", "Stage", "Task"],
            ["T1", "Site Survey", "Measure site"],
            ["T2", "Handover", "Inspect finish"],
            ["T3", "Handover", "Return keys"],
          ],
        },
        {
          name: "Options & Approvals",
          rows: [
            [
              "Task ID",
              "Stage / gate",
              "Option / milestone",
              "Description / key differences",
              "Client response",
            ],
            ["", "Site Survey", "Survey sign-off", "Confirm measurements", "Pending"],
            ["T3", "Handover", "Keys sign-off", "Confirm receipt", ""],
          ],
        },
      ]),
      "example",
    );
    expect(plan.planned_approval_records.map((row) => row.related_task_source_id)).toEqual([
      "T1",
      "T3",
    ]);
    expect(
      plan.planned_approval_records.every(
        (row) => row.original.client_response === "Pending" && row.original.signoff_date === null,
      ),
    ).toBe(true);
  });

  it("keeps ambiguous approval rows and extra columns as sourced notes rather than guessing relationships", async () => {
    const { plan, warnings } = await parseProjectPlanFile(
      workbook([
        {
          name: "Tasks",
          rows: [
            ["Task ID", "Stage", "Task", "Vendor preference"],
            ["T1", "Handover", "Inspect finish", "Source-only preference"],
            ["T2", "Handover", "Return keys"],
          ],
        },
        {
          name: "Options & Approvals",
          rows: [
            ["Stage / gate", "Option / milestone", "Description / key differences"],
            ["Handover", "Final sign-off", "Review everything"],
          ],
        },
        {
          name: "Project Overview",
          rows: [
            ["Project name", "Fictional studio"],
            ["Client name", "Sample client"],
            ["Max options", "Three"],
            ["Material selection", "Ask before purchase"],
          ],
        },
      ]),
      "example",
    );
    expect(plan.planned_approval_records).toEqual([]);
    expect(plan.tasks[0]?.mapping_notes).toContain(
      "Source Vendor preference: Source-only preference",
    );
    expect(
      plan.workbook_workflow_notes.items.some(
        (row) =>
          row.source_sheet === "Options & Approvals" &&
          row.source_cell === "A2" &&
          row.text.includes("Final sign-off"),
      ),
    ).toBe(true);
    expect(plan.project_metadata).toMatchObject({
      project_name: "Fictional studio",
      client_name: "Sample client",
    });
    expect(warnings.some((text) => text.includes("Add a matching Task ID"))).toBe(true);
  });

  it("does not collapse different non-Latin source stages into the same approval match", async () => {
    const { plan, unmappedStages } = await parseProjectPlanFile(
      workbook([
        {
          name: "Tasks",
          rows: [
            ["Stage", "Task", ""],
            ["सर्वेक्षण", "Measure site", "Unnamed source detail"],
          ],
        },
        {
          name: "Approvals",
          rows: [
            ["Stage / gate", "Option / milestone"],
            ["निर्माण", "Review build"],
          ],
        },
      ]),
      "example",
    );
    expect(unmappedStages).toEqual(["सर्वेक्षण"]);
    expect(plan.planned_approval_records).toEqual([]);
    expect(plan.tasks[0]?.mapping_notes).toContain("Source Column 3: Unnamed source detail");
    expect(
      plan.workbook_workflow_notes.items.some((row) => row.text.includes("Review build")),
    ).toBe(true);
  });

  it("rejects inconsistent ZIP local size metadata before SheetJS can allocate from it", async () => {
    const source = workbook([
      {
        name: "Tasks",
        rows: [
          ["Stage", "Task"],
          ["Handover", "Final check"],
        ],
      },
    ]);
    const bytes = new Uint8Array(await source.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    view.setUint32(22, 0x7fffffff, true);
    await expect(parseProjectPlanFile(file("corrupt.xlsx", bytes), "example")).rejects.toThrow(
      "inconsistent ZIP size metadata",
    );
  });

  it("rejects existing work/approval history instead of turning it into fabricated new progress", async () => {
    for (const extra of [
      "Status\nExecution,Build units,Done",
      "Completed on\nExecution,Build units,2026-11-20",
      "Client approval\nExecution,Build units,Approved",
    ]) {
      await expect(
        parseProjectPlanFile(file("history.csv", `Stage,Task,${extra}\n`), "example"),
      ).rejects.toThrow("only new, Not Started");
    }
    await expect(
      parseProjectPlanFile(
        workbook([
          {
            name: "Tasks",
            rows: [
              ["Task ID", "Stage", "Task"],
              ["T1", "Handover", "Final check"],
            ],
          },
          {
            name: "Approvals",
            rows: [
              ["Task ID", "Stage / gate", "Option / milestone", "Client response"],
              ["T1", "Handover", "Sign-off", "Approved"],
            ],
          },
        ]),
        "example",
      ),
    ).rejects.toThrow("not historical client responses");
  });

  it("rejects formulas, duplicate IDs, duplicate fields, missing task fields and invalid priorities/date ordering", async () => {
    await expect(
      parseProjectPlanFile(
        workbook([
          {
            name: "Tasks",
            rows: [
              ["Stage", "Task"],
              ["Handover", "Cached task"],
            ],
            edit: (sheet) => {
              sheet["B2"] = { t: "s", v: "Cached task", f: 'CONCAT("Task"," two")' };
            },
          },
        ]),
        "example",
      ),
    ).rejects.toThrow("replace formulas");
    await expect(
      parseProjectPlanFile(
        file("dup.csv", "ID,Stage,Task\nT1,Handover,One\nT1,Handover,Two"),
        "example",
      ),
    ).rejects.toThrow("Task ID must be unique");
    await expect(
      parseProjectPlanFile(file("dup.csv", "Stage,Task,Task title\nHandover,One,Two"), "example"),
    ).rejects.toThrow("repeats");
    await expect(
      parseProjectPlanFile(file("blank.csv", "Stage,Task\n,Missing stage"), "example"),
    ).rejects.toThrow("both Stage and Task");
    await expect(
      parseProjectPlanFile(
        file("priority.csv", "Stage,Task,Priority\nHandover,Inspect,Urgent"),
        "example",
      ),
    ).rejects.toThrow("Low, Medium or High");
    await expect(
      parseProjectPlanFile(
        file("date.csv", "Stage,Task,Start date,Due date\nHandover,Inspect,2026-11-22,2026-11-21"),
        "example",
      ),
    ).rejects.toThrow("before Start date");
  });

  it("rejects excess rows, columns, tasks, invalid files and unsupported encodings without truncation", async () => {
    await expect(
      parseProjectPlanFile(
        file(
          "large.csv",
          "Stage,Task\n" +
            Array.from({ length: 501 }, (_, index) => `Handover,Task ${index}\n`).join(""),
        ),
        "example",
      ),
    ).rejects.toThrow("500 tasks");
    await expect(
      parseProjectPlanFile(
        workbook([
          {
            name: "Too many rows",
            rows: [["Stage", "Task"]],
            edit: (sheet) => {
              sheet["A2001"] = { t: "s", v: "Handover" };
              sheet["B2001"] = { t: "s", v: "Out-of-range task" };
              sheet["!ref"] = "A1:B2001";
            },
          },
        ]),
        "example",
      ),
    ).rejects.toThrow("exceeds 2000 rows");
    await expect(
      parseProjectPlanFile(
        file("columns.csv", Array.from({ length: 65 }, (_, index) => `Column${index}`).join(",")),
        "example",
      ),
    ).rejects.toThrow("64 columns");
    await expect(
      parseProjectPlanFile(
        { ...file("large.csv", "test"), size: PROJECT_PLAN_FILE_MAX_BYTES + 1 },
        "example",
      ),
    ).rejects.toThrow("5 MB");
    await expect(
      parseProjectPlanFile(file("bad.xlsx", "not an excel workbook"), "example"),
    ).rejects.toThrow("not an Excel workbook");
    await expect(
      parseProjectPlanFile(file("bad.csv", new Uint8Array([0xff, 0xfe, 0x00])), "example"),
    ).rejects.toThrow("UTF-8");
    await expect(parseProjectPlanFile(file("old.xls", "old format"), "example")).rejects.toThrow(
      ".xlsx or CSV",
    );
  });

  it("provides an Excel-readable template with human stage labels and no client or financial data", async () => {
    const template = createProjectPlanTemplate();
    expect(template.filename).toMatch(/\.csv$/);
    expect(template.mime).toContain("text/csv");
    const result = await parseProjectPlanFile(
      file(template.filename, template.contents),
      "example",
    );
    expect(result.plan.tasks).toHaveLength(2);
    expect(result.unmappedStages).toEqual([]);
    expect(result.plan.tasks.map((task) => task.original.stage)).toEqual([
      "Planning & Brief",
      "Site Survey",
    ]);
    expect(result.plan.project_metadata.client_email).toBeNull();
  });
});
