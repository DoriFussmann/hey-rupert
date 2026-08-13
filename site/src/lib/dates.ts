export function isoDate(value: Date): string {
  return value.toISOString();
}

export function displayDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
