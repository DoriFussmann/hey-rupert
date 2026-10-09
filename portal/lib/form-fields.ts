export const STATEMENT_OF_WORK_SLUG = "statement_of_work";
export const SERVICE_ORDER_SLUG = "service_order";

export type FormSlug = typeof STATEMENT_OF_WORK_SLUG | typeof SERVICE_ORDER_SLUG;

export const FORM_TITLES: Record<FormSlug, string> = {
  [STATEMENT_OF_WORK_SLUG]: "Statement of Work",
  [SERVICE_ORDER_SLUG]: "Service Order",
};

export function isFormSlug(value: string): value is FormSlug {
  return value === STATEMENT_OF_WORK_SLUG || value === SERVICE_ORDER_SLUG;
}
