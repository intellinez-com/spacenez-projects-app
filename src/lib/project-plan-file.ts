import type { CellObject, WorkBook, WorkSheet } from "xlsx";
import { STAGES } from "@/lib/constants";
import { projectImportSchema, type ProjectImportPlan } from "@/lib/project-import";

export const PROJECT_PLAN_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const PROJECT_PLAN_FILE_ACCEPT = ".xlsx,.csv";
const MAX_SHEETS = 20,
  MAX_ROWS = 2_000,
  MAX_COLUMNS = 64,
  MAX_TASKS = 500;
type PlanFile = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
export type ProjectPlanFileResult = {
  plan: ProjectImportPlan;
  warnings: string[];
  unmappedStages: string[];
};
type Field =
  | "id"
  | "stage"
  | "task"
  | "description"
  | "owner"
  | "start"
  | "due"
  | "priority"
  | "status"
  | "completed"
  | "clientApproval"
  | "evidence"
  | "notes"
  | "milestone"
  | "approvalDescription"
  | "shared"
  | "response"
  | "selected"
  | "signoff";
type Header = { row: number; columns: Map<Field, number>; labels: string[]; approval: boolean };
type PendingApproval = {
  sheet: string;
  row: number;
  taskId: string;
  stage: string;
  milestone: string;
  description: string | null;
  proof: string | null;
  notes: string | null;
  source: string;
};
const norm = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const aliases: Record<Field, string[]> = {
  id: ["task id", "id", "source id", "related task id"],
  stage: ["stage", "stage phase", "stage gate", "phase"],
  task: [
    "task",
    "task title",
    "title",
    "activity deliverable",
    "activity",
    "deliverable",
    "task activity",
  ],
  description: ["description", "acceptance criteria", "acceptance criteria scope", "scope"],
  owner: ["owner", "responsible", "assignee", "assigned to"],
  start: ["start date", "start"],
  due: ["due date", "due", "deadline"],
  priority: ["priority"],
  status: ["status", "task status"],
  completed: ["completed on", "completion date"],
  clientApproval: ["client approval", "approval status"],
  evidence: [
    "evidence",
    "evidence link",
    "evidence file link",
    "approval proof link",
    "proof link",
  ],
  notes: ["notes", "remarks", "remarks blocker", "remarks revision"],
  milestone: ["approval milestone", "option milestone", "milestone"],
  approvalDescription: ["approval description", "description key differences"],
  shared: ["shared on"],
  response: ["client response"],
  selected: ["selected"],
  signoff: ["sign off date", "signoff date"],
};
const validDate = (text: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text) &&
  Number.isFinite(Date.parse(`${text}T00:00:00Z`)) &&
  new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
const optional = (text: string) => (text.trim() ? text : null);

/** A CSV template opens in Excel; dates are deliberately ISO text to avoid locale guesses. */
export function createProjectPlanTemplate() {
  return {
    filename: "Spacenez_Project_Plan_Template.csv",
    mime: "text/csv;charset=utf-8",
    contents:
      "\uFEFFTask ID,Stage,Task,Description,Start date,Due date,Priority,Owner,Approval milestone,Approval description,Notes\r\n" +
      "T01,Planning & Brief,Replace with your first task,Describe what should be delivered,,,Medium,,,,\r\n" +
      "T02,Site Survey,Replace with your next task,,,,Medium,,,,\r\n",
  };
}

// Inspect ZIP directory sizes before decompression. This is a resource bound,
// not a file trust decision; all parsed cells still undergo validation below.
function checkXlsxArchive(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error(
      "The selected .xlsx file is not an Excel workbook. Save it as .xlsx and try again.",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0)
    throw new Error("The Excel workbook is damaged or unsupported. Save a fresh .xlsx copy.");
  const entries = view.getUint16(end + 10, true),
    start = view.getUint32(end + 16, true),
    directorySize = view.getUint32(end + 12, true);
  if (
    entries > 5_000 ||
    entries === 0xffff ||
    start >= end ||
    start + directorySize > end ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== entries
  )
    throw new Error("This workbook is too complex. Copy the plan into the import template.");
  const checkExtra = (offset: number, length: number) => {
    const limit = offset + length;
    while (offset < limit) {
      if (offset + 4 > limit) throw new Error("The Excel workbook directory is damaged.");
      const kind = view.getUint16(offset, true),
        size = view.getUint16(offset + 2, true);
      if (kind === 1)
        throw new Error(
          "ZIP64 workbooks are not supported. Save a standard .xlsx copy or use the CSV template.",
        );
      offset += 4 + size;
      if (offset > limit) throw new Error("The Excel workbook directory is damaged.");
    }
  };
  const paths = new Set<string>();
  let cursor = start,
    expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("The Excel workbook directory is damaged.");
    const flags = view.getUint16(cursor + 8, true),
      method = view.getUint16(cursor + 10, true),
      compressed = view.getUint32(cursor + 20, true),
      size = view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true),
      extraSize = view.getUint16(cursor + 30, true),
      local = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameSize + extraSize + view.getUint16(cursor + 32, true);
    if (next > end || local + 30 > start || view.getUint32(local, true) !== 0x04034b50)
      throw new Error("The Excel workbook directory is damaged.");
    const localFlags = view.getUint16(local + 6, true),
      localMethod = view.getUint16(local + 8, true),
      localName = view.getUint16(local + 26, true),
      localExtra = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localName + localExtra;
    expanded += size;
    if (expanded > 40 * 1024 * 1024 || flags & 0x2041 || localFlags & 0x2041)
      throw new Error("Choose an unencrypted workbook with less than 40 MB of expanded data.");
    if (flags & 8 || localFlags & 8)
      throw new Error(
        "Streaming Excel archives are not supported. Save a standard .xlsx copy or use the CSV template.",
      );
    if (
      localFlags !== flags ||
      localMethod !== method ||
      ![0, 8].includes(method) ||
      (method === 0 && compressed !== size) ||
      view.getUint32(local + 18, true) !== compressed ||
      view.getUint32(local + 22, true) !== size ||
      dataStart + compressed > start ||
      localName !== nameSize ||
      view.getUint16(cursor + 34, true)
    ) {
      throw new Error(
        "The workbook has inconsistent ZIP size metadata. Save a fresh .xlsx copy or use the CSV template.",
      );
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize),
      localBytes = bytes.subarray(local + 30, local + 30 + localName);
    if (nameBytes.some((value, at) => value !== localBytes[at]))
      throw new Error("The Excel workbook directory is damaged.");
    const path = Array.from(nameBytes).join(",");
    if (paths.has(path))
      throw new Error("The workbook contains duplicate ZIP entries. Save a fresh .xlsx copy.");
    paths.add(path);
    checkExtra(cursor + 46 + nameSize, extraSize);
    checkExtra(local + 30 + localName, localExtra);
    cursor = next;
  }
  if (cursor !== start + directorySize) throw new Error("The Excel workbook directory is damaged.");
}

/** Parse local files only. This function performs no API or database writes. */
export async function parseProjectPlanFile(
  file: PlanFile,
  backendRef: string,
): Promise<ProjectPlanFileResult> {
  if (!/\.(xlsx|csv)$/i.test(file.name))
    throw new Error(
      "Choose an Excel .xlsx or CSV .csv file. Prepared JSON is available under Advanced import.",
    );
  if (!file.size || file.size > PROJECT_PLAN_FILE_MAX_BYTES)
    throw new Error("Choose a nonempty project plan smaller than 5 MB.");
  if (!backendRef.trim() || backendRef.length > 100)
    throw new Error("The app backend is not configured.");
  const data = await file.arrayBuffer();
  if (
    !data.byteLength ||
    data.byteLength > PROJECT_PLAN_FILE_MAX_BYTES ||
    data.byteLength !== file.size
  )
    throw new Error("The selected file changed or exceeds 5 MB. Choose it again.");
  const bytes = new Uint8Array(data),
    isExcel = /\.xlsx$/i.test(file.name);
  let csvText: string | undefined;
  if (isExcel) checkXlsxArchive(bytes);
  else {
    try {
      csvText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (csvText.includes("\0") || /^\s*</.test(csvText)) throw new Error();
    } catch {
      throw new Error("Save the CSV as UTF-8 text, or upload an .xlsx workbook.");
    }
  }
  const xlsx = await import("xlsx");
  let workbook: WorkBook;
  try {
    workbook = xlsx.read(csvText ?? bytes, {
      type: isExcel ? "array" : "string",
      raw: true,
      cellDates: false,
      cellNF: true,
      cellHTML: false,
      cellFormula: true,
      sheetRows: MAX_ROWS + 1,
    });
  } catch {
    throw new Error(
      "This file could not be read. Save a fresh .xlsx or UTF-8 CSV copy and try again.",
    );
  }
  if (!workbook.SheetNames.length || workbook.SheetNames.length > MAX_SHEETS)
    throw new Error(`Choose a workbook with between 1 and ${MAX_SHEETS} sheets.`);
  const warnings: string[] = [],
    unknown = new Set<string>(),
    notes: ProjectImportPlan["workbook_workflow_notes"]["items"] = [];
  const tasks: ProjectImportPlan["tasks"] = [],
    approvals: ProjectImportPlan["planned_approval_records"] = [],
    pending: PendingApproval[] = [];
  const sourceIds = new Set<string>();
  const metadata = {
    project_name: file.name
      .replace(/\.(xlsx|csv)$/i, "")
      .replace(/[_-]+/g, " ")
      .slice(0, 200),
    client_name: null as string | null,
    site_location: null as string | null,
    project_manager: null as string | null,
    kickoff_date: null as string | null,
    project_name_status: "Filename suggestion; review before import",
    client_brand: null as string | null,
    client_email: null as string | null,
  };
  const addWarning = (message: string) => {
    if (warnings.length < 100) warnings.push(message);
    else if (warnings.length === 100)
      warnings.push("More warnings exist. Review the source notes and each task before importing.");
  };
  const addNote = (sheet: string, row: number, text: string) => {
    if (notes.length >= 100 || text.length > 20_000)
      throw new Error(
        "This workbook has too many source notes. Keep the project plan and its essential notes in a smaller file.",
      );
    notes.push({ source_sheet: sheet, source_cell: `A${row}`, text });
  };
  const cellAt = (sheet: WorkSheet, row: number, column: number): CellObject | undefined =>
    sheet[xlsx.utils.encode_cell({ r: row, c: column })] as CellObject | undefined;
  const textAt = (sheet: WorkSheet, row: number, column: number) => {
    const cell = cellAt(sheet, row, column);
    if (!cell || cell.v === null || cell.v === undefined) return "";
    const value = String(cell.w ?? cell.v);
    if (value.length > 20_000)
      throw new Error(
        `Cell ${xlsx.utils.encode_cell({ r: row, c: column })} is too long. Use fewer than 20,000 characters per cell.`,
      );
    return value;
  };
  const findHeader = (
    sheet: WorkSheet,
    lastRow: number,
    lastColumn: number,
  ): Header | undefined => {
    for (let row = 0; row <= Math.min(lastRow, 49); row++) {
      const columns = new Map<Field, number>(),
        labels = Array.from({ length: lastColumn + 1 }, (_, column) => textAt(sheet, row, column));
      for (const [column, label] of labels.entries())
        for (const key of Object.keys(aliases) as Field[]) {
          if (!aliases[key].includes(norm(label))) continue;
          if (columns.has(key))
            throw new Error(
              `Header row ${row + 1} repeats the ${key} column. Keep one column for each field.`,
            );
          columns.set(key, column);
        }
      if (columns.has("stage") && (columns.has("task") || columns.has("milestone")))
        return { row, columns, labels, approval: !columns.has("task") };
    }
    return undefined;
  };
  const dateValue = (
    sheet: WorkSheet,
    row: number,
    column: number | undefined,
    sheetName: string,
    label: string,
    mapping: string[],
  ) => {
    if (column === undefined) return null;
    const raw = textAt(sheet, row, column),
      cell = cellAt(sheet, row, column);
    if (!raw.trim()) return null;
    if (validDate(raw.trim())) return raw.trim();
    const dateFormat = typeof cell?.z === "string" ? cell.z : "";
    if (
      cell?.t === "n" &&
      typeof cell.v === "number" &&
      dateFormat &&
      xlsx.SSF.is_date(dateFormat)
    ) {
      const decoded = xlsx.SSF.parse_date_code(cell.v, {
        date1904: !!workbook.Workbook?.WBProps?.date1904,
      });
      const format = dateFormat.replace(/"[^"]*"|\\./g, "").replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
      const dateOnlyFormat = !/[hs]|am\/pm|a\/p|\[m\]/i.test(format);
      if (decoded && (dateOnlyFormat || (!decoded.H && !decoded.M && !decoded.S && !decoded.u))) {
        const value = `${String(decoded.y).padStart(4, "0")}-${String(decoded.m).padStart(2, "0")}-${String(decoded.d).padStart(2, "0")}`;
        if (validDate(value)) {
          mapping.push(
            `${label}: Excel date ${String(cell.v)} displayed as ${raw}; normalized to ${value}.`,
          );
          return value;
        }
      }
    }
    mapping.push(`${label} kept as source text and left undated: ${raw}`);
    addWarning(
      `${sheetName} row ${row + 1}: ${label.toLowerCase()} “${raw}” needs a calendar date (YYYY-MM-DD).`,
    );
    return null;
  };
  for (const [sheetIndex, name] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = xlsx.utils.decode_range((sheet["!fullref"] as string) || sheet["!ref"]);
    if (range.e.r >= MAX_ROWS || range.e.c >= MAX_COLUMNS)
      throw new Error(
        `${name} exceeds ${MAX_ROWS} rows or ${MAX_COLUMNS} columns. Copy the relevant plan into the template; no rows were imported.`,
      );
    const header = findHeader(sheet, range.e.r, range.e.c);
    if (!header) {
      for (let row = 0; row <= range.e.r; row++) {
        const values = Array.from({ length: range.e.c + 1 }, (_, column) =>
          textAt(sheet, row, column),
        ).filter((value) => value.trim());
        if (!values.length) continue;
        addNote(name, row + 1, values.join(" | "));
        if (/^(project )?(overview|details)$/i.test(name.trim()) && values.length >= 2) {
          const key = norm(values[0] ?? ""),
            value = values[1] ?? "";
          const field = (
            {
              "project name": "project_name",
              "client name": "client_name",
              location: "site_location",
              "site location": "site_location",
              "project manager": "project_manager",
              "client brand": "client_brand",
              "client email": "client_email",
            } as const
          )[key as "project name"];
          if (field && value.trim()) {
            metadata[field] = value.trim();
            if (field === "project_name")
              metadata.project_name_status = `Project name from ${name} row ${row + 1}; review before import`;
          }
        }
      }
      addWarning(
        `${name}: no Stage + Task header was found; its nonempty rows were kept as project notes.`,
      );
      continue;
    }
    for (let row = 0; row < header.row; row++) {
      const values = Array.from({ length: range.e.c + 1 }, (_, column) =>
        textAt(sheet, row, column),
      ).filter((value) => value.trim());
      if (values.length) addNote(name, row + 1, values.join(" | "));
    }
    const knownColumns = new Set(header.columns.values());
    const extras = header.labels.flatMap((_label, column) =>
      !knownColumns.has(column) ? [column] : [],
    );
    const extraLabel = (column: number) => header.labels[column]?.trim() || `Column ${column + 1}`;
    if (extras.some((column) => header.labels[column]?.trim()))
      addWarning(
        `${name}: extra columns are retained in source notes, not used as task fields: ${extras
          .filter((column) => header.labels[column]?.trim())
          .map(extraLabel)
          .join(", ")}.`,
      );
    const read = (row: number, field: Field) => {
      const column = header.columns.get(field);
      return column === undefined ? "" : textAt(sheet, row, column);
    };
    for (let row = header.row + 1; row <= range.e.r; row++) {
      const cells = Array.from({ length: range.e.c + 1 }, (_, column) =>
        textAt(sheet, row, column),
      );
      if (cells.every((value) => !value.trim())) continue;
      for (const column of header.columns.values()) {
        const cell = cellAt(sheet, row, column);
        if (cell?.f || cell?.t === "e" || /^\s*=/.test(textAt(sheet, row, column)))
          throw new Error(
            `${name}!${xlsx.utils.encode_cell({ r: row, c: column })}: replace formulas or spreadsheet errors with plain values before importing.`,
          );
      }
      const title = read(row, header.approval ? "milestone" : "task"),
        stage = read(row, "stage");
      if (!title.trim() && !stage.trim()) {
        addNote(name, row + 1, cells.filter(Boolean).join(" | "));
        continue;
      }
      if (!title.trim() || !stage.trim())
        throw new Error(
          `${name} row ${row + 1}: both Stage and ${header.approval ? "Approval milestone" : "Task"} are required.`,
        );
      if (header.approval) {
        if (
          read(row, "shared").trim() ||
          read(row, "selected").trim() ||
          read(row, "signoff").trim() ||
          !["", "pending"].includes(norm(read(row, "response")))
        )
          throw new Error(
            `${name} row ${row + 1}: this imports future approval plans, not historical client responses or sign-offs.`,
          );
        pending.push({
          sheet: name,
          row: row + 1,
          taskId: read(row, "id").trim(),
          stage,
          milestone: title,
          description: optional(read(row, "approvalDescription") || read(row, "description")),
          proof: optional(read(row, "evidence")),
          notes: optional(read(row, "notes")),
          source: cells
            .map((value, column) =>
              value ? `${header.labels[column] || `Column ${column + 1}`}: ${value}` : "",
            )
            .filter(Boolean)
            .join(" | "),
        });
        if (pending.length > 500)
          throw new Error("Choose a plan with no more than 500 planned approvals.");
        continue;
      }
      if (
        !["", "not started"].includes(norm(read(row, "status"))) ||
        read(row, "completed").trim() ||
        !["", "not requested"].includes(norm(read(row, "clientApproval"))) ||
        read(row, "shared").trim() ||
        read(row, "selected").trim() ||
        read(row, "signoff").trim() ||
        !["", "pending"].includes(norm(read(row, "response")))
      )
        throw new Error(
          `${name} row ${row + 1}: only new, Not Started work with no completion or approval history can be imported. Record live progress in the app.`,
        );
      const id = read(row, "id").trim() || `sheet-${sheetIndex + 1}-row-${row + 1}`;
      if (id.length > 100 || sourceIds.has(id))
        throw new Error(
          `${name} row ${row + 1}: Task ID must be unique and no longer than 100 characters.`,
        );
      sourceIds.add(id);
      const mapping = extras.flatMap((column) =>
        cells[column]?.trim() ? [`Source ${extraLabel(column)}: ${cells[column]}`] : [],
      );
      if (extras.some((column) => !header.labels[column]?.trim() && cells[column]?.trim()))
        addWarning(
          `${name} row ${row + 1}: unnamed columns were kept in source notes; give them a recognized header to use them as task fields.`,
        );
      if (read(row, "status") && read(row, "status") !== "Not Started")
        mapping.push(
          `Source status text “${read(row, "status")}” means Not Started; no progress history is created.`,
        );
      if (read(row, "clientApproval") && read(row, "clientApproval") !== "Not Requested")
        mapping.push(
          `Source client-approval text “${read(row, "clientApproval")}” means Not Requested; no decision is created.`,
        );
      const sourceStage = STAGES.find(
        (item) => norm(item.label) === norm(stage) || norm(item.key) === norm(stage),
      );
      if (!sourceStage) {
        unknown.add(stage);
        mapping.push(
          `Stage “${stage}” needs an admin mapping before import; planning is a temporary preview placeholder.`,
        );
      }
      const start = dateValue(sheet, row, header.columns.get("start"), name, "Start date", mapping),
        due = dateValue(sheet, row, header.columns.get("due"), name, "Due date", mapping);
      if (start && due && due < start)
        throw new Error(`${name} row ${row + 1}: Due date is before Start date.`);
      const priority = norm(read(row, "priority")) || "medium";
      if (!["low", "medium", "high"].includes(priority))
        throw new Error(`${name} row ${row + 1}: Priority must be Low, Medium or High.`);
      const owner = optional(read(row, "owner"));
      if (owner) {
        mapping.push(
          `Source owner “${owner}” retained as text; assign an invited team member after import.`,
        );
        addWarning(`${name} row ${row + 1}: owner “${owner}” is not assigned automatically.`);
      }
      const description = optional(read(row, "description"));
      tasks.push({
        source_id: id,
        source_sheet: name,
        source_row: row + 1,
        original: {
          id,
          stage,
          title,
          acceptance_criteria: description,
          responsible: owner,
          start_date: start ?? optional(read(row, "start")),
          due_date: due ?? optional(read(row, "due")),
          status: "Not Started",
          completed_on: null,
          client_approval: "Not Requested",
          evidence_link: optional(read(row, "evidence")),
          remarks: optional(read(row, "notes")),
        },
        proposed_task: {
          title,
          description,
          stage: sourceStage?.key ?? "planning",
          status: "not_started",
          priority: priority as "low" | "medium" | "high",
          assignee_id: null,
          start_date: start,
          due_date: due,
          position: tasks.length,
        },
        mapping_notes: mapping,
      });
      if (tasks.length > MAX_TASKS)
        throw new Error(
          `Choose a plan with no more than ${MAX_TASKS} tasks. No rows were imported.`,
        );
      const inlineMilestone = read(row, "milestone");
      if (inlineMilestone.trim())
        approvals.push({
          source_sheet: name,
          source_row: row + 1,
          related_task_source_id: id,
          original: {
            stage_gate: stage,
            option_milestone: inlineMilestone,
            description: optional(read(row, "approvalDescription")),
            shared_on: null,
            client_response: "Pending",
            selected: null,
            signoff_date: null,
            proof_link: null,
            remarks: null,
          },
          mapping_note:
            "Future approval plan linked to this task row. No approval request or decision is created.",
        });
    }
  }
  if (!tasks.length)
    throw new Error(
      "No tasks were found. Use a header row with Stage and Task columns and add at least one task below it.",
    );
  for (const item of pending) {
    let candidates = item.taskId
      ? tasks.filter((task) => task.source_id === item.taskId)
      : tasks.filter((task) => norm(task.original.stage) === norm(item.stage));
    if (item.taskId && candidates.length !== 1)
      throw new Error(
        `${item.sheet} row ${item.row}: Task ID “${item.taskId}” does not match an imported task.`,
      );
    if (!item.taskId && candidates.length !== 1)
      candidates = candidates.filter((task) => norm(task.original.title) === norm(item.milestone));
    const linked = candidates.length === 1 ? candidates[0] : undefined;
    if (!linked) {
      addNote(item.sheet, item.row, `Unlinked planned approval: ${item.source}`);
      addWarning(
        `${item.sheet} row ${item.row}: planned approval “${item.milestone}” was kept as a project note. Add a matching Task ID column to create a linked approval.`,
      );
      continue;
    }
    approvals.push({
      source_sheet: item.sheet,
      source_row: item.row,
      related_task_source_id: linked.source_id,
      original: {
        stage_gate: item.stage,
        option_milestone: item.milestone,
        description: item.description,
        shared_on: null,
        client_response: "Pending",
        selected: null,
        signoff_date: null,
        proof_link: item.proof,
        remarks: item.notes,
      },
      mapping_note: item.taskId
        ? "Linked by explicit source Task ID; future plan only."
        : "Linked by a unique source-stage/task match; future plan only.",
    });
  }
  if (approvals.length > 500)
    throw new Error("Choose a plan with no more than 500 planned approvals.");
  for (const stage of unknown)
    addWarning(`Map source stage “${stage}” to an app stage before importing.`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const sha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const plan = projectImportSchema.parse({
    format: "spacenez.project-import-staging.v1",
    state: "STAGING_ONLY_NOT_IMPORTED",
    source: { filename: file.name, sha256, sheets: workbook.SheetNames },
    target_backend_ref: backendRef,
    target_project_id: null,
    project_metadata: metadata,
    tasks,
    planned_approval_records: approvals,
    workbook_workflow_notes: {
      classification: "Source workbook notes; treat as project content",
      items: notes,
    },
    overview_material_selection_note: {
      source_cell: "",
      text: "",
      note: "Source overview content is retained in workbook notes; no additional work is invented.",
    },
    summary: {
      tasks: tasks.length,
      planned_approval_rows: approvals.length,
      statuses: { "Not Started": tasks.length },
      dated_starts: tasks.filter((task) => task.proposed_task.start_date).length,
      missing_owners: tasks.filter((task) => !task.original.responsible).length,
      missing_due_dates: tasks.filter((task) => !task.proposed_task.due_date).length,
    },
    prerequisites: [
      "Review project details, source warnings and stage mappings before import.",
      "Invite the client and partners separately; source owner text does not grant access.",
    ],
    defaults: {
      priority: "Medium when blank",
      assignee_id: "Unassigned; admins choose invited members in the app",
    },
    metadata_provenance: {
      source: "Selected spreadsheet; SHA-256 of original bytes",
      client_brand: "Source overview when provided; otherwise unset",
      project_name: metadata.project_name_status,
      client_name: "Source overview when provided; otherwise unset",
      project_manager: "Source overview when provided; otherwise unset",
      kickoff_date: "Unset; admin supplies a calendar date",
      task_owners: "Source owner text only; no account matching",
    },
    proposed_client_profile: {
      full_name: metadata.client_name,
      email: metadata.client_email,
      company: metadata.client_brand,
      requested_project_access: "client",
      profile_id: null,
      state: "No account is created by reading this file",
    },
  });
  if (JSON.stringify(plan).length > 2_000_000)
    throw new Error(
      "The imported plan and source notes exceed 2 MB. Split this into a smaller project plan.",
    );
  return { plan, warnings, unmappedStages: [...unknown] };
}
