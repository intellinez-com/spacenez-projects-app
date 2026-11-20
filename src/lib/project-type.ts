/** Unspecified import categories are useful in Details, but add no context to a project heading. */
export function projectTypeLabel(value: string | null | undefined): string | null {
  const label = value?.trim();
  return !label || label.toLowerCase() === "other" ? null : label;
}
