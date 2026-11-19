import { isBefore, isValid, parseISO, startOfDay } from "date-fns";

/** A date-only deadline remains due throughout that calendar day. */
export function isTaskOverdue(task: { status: string; due_date: string | null }, now = new Date()) {
  if (task.status === "done" || !task.due_date) return false;
  const date = parseISO(task.due_date);
  return isValid(date) && isBefore(date, startOfDay(now));
}
