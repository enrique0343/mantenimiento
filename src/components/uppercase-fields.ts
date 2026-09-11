type TextField = HTMLInputElement | HTMLTextAreaElement;

const selector = "input[data-uppercase], textarea[data-uppercase]";
const installed = new WeakSet<Document>();

function isTextField(value: unknown): value is TextField {
  return value instanceof HTMLTextAreaElement ||
    (value instanceof HTMLInputElement && ["text", "search"].includes(value.type));
}

/** Convert the stored value, preserving selection even when a letter expands. */
export function uppercaseField(field: TextField): void {
  if (!isTextField(field) || field.readOnly || field.disabled) return;
  const before = field.value;
  const after = before.toLocaleUpperCase("es");
  if (after === before) return;

  const start = field.selectionStart;
  const end = field.selectionEnd;
  const direction = field.selectionDirection;
  const top = field.scrollTop;
  const left = field.scrollLeft;
  field.value = after;
  if (start !== null && end !== null) {
    field.setSelectionRange(
      before.slice(0, start).toLocaleUpperCase("es").length,
      before.slice(0, end).toLocaleUpperCase("es").length,
      direction ?? "none",
    );
  }
  field.scrollTop = top;
  field.scrollLeft = left;
}

/** Only explicitly marked free-text fields participate; enum values stay intact. */
export function installUppercaseFields(root: Document = document): void {
  if (installed.has(root)) return;
  installed.add(root);
  const composing = new WeakSet<TextField>();
  const fieldFor = (target: EventTarget | null) =>
    isTextField(target) && target.matches(selector) ? target : null;

  const initialize = () => {
    root.querySelectorAll<TextField>(selector).forEach(field => {
      if (!isTextField(field)) return;
      field.setAttribute("autocapitalize", "characters");
      uppercaseField(field);
    });
  };
  root.addEventListener("compositionstart", event => {
    const field = fieldFor(event.target);
    if (field) composing.add(field);
  }, true);
  root.addEventListener("compositionend", event => {
    const field = fieldFor(event.target);
    if (!field) return;
    composing.delete(field);
    uppercaseField(field);
  }, true);
  root.addEventListener("input", event => {
    const field = fieldFor(event.target);
    if (field && !composing.has(field) && !(event as InputEvent).isComposing) uppercaseField(field);
  }, true);
  root.addEventListener("change", event => {
    const field = fieldFor(event.target);
    if (field && !composing.has(field)) uppercaseField(field);
  }, true);
  root.addEventListener("submit", event => {
    if (!(event.target instanceof HTMLFormElement)) return;
    const fields = Array.from(event.target.querySelectorAll<TextField>(selector));
    // Do not submit the uncommitted text while an IME is still composing it.
    if (fields.some(field => composing.has(field))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    fields.forEach(uppercaseField);
  }, true);
  root.addEventListener("astro:page-load", initialize);
  initialize();
}
