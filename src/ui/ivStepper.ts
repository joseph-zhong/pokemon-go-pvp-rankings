export interface IvStepperHandle {
  get(): number;
  set(value: number): void;
  input: HTMLInputElement;
}

function clamp(v: number): number {
  return Math.min(15, Math.max(0, Math.round(v)));
}

export function createIvStepper(container: HTMLElement, onChange: () => void): IvStepperHandle {
  const input = container.querySelector("input") as HTMLInputElement;
  const buttons = container.querySelectorAll<HTMLButtonElement>(".stepper-btn");
  let valueBeforeFocus = input.value;

  function get(): number {
    const n = Number(input.value);
    return Number.isFinite(n) ? clamp(n) : 0;
  }

  function set(value: number) {
    input.value = String(clamp(value));
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      set(get() + Number(btn.dataset.dir));
      onChange();
    });
  });

  input.addEventListener("input", onChange);

  // Clear on focus so clicking into the field to enter a new value doesn't
  // require backspacing the old one first; remembered so blurring without
  // typing anything restores it instead of snapping to 0.
  input.addEventListener("focus", () => {
    valueBeforeFocus = input.value;
    input.value = "";
  });

  // Snap out-of-range or partial values back into 0-15 once the user leaves
  // the field. An empty field left untouched since focus restores the prior
  // value instead of resetting to 0.
  input.addEventListener("blur", () => {
    if (input.value === "") {
      input.value = valueBeforeFocus;
      return;
    }
    set(get());
    onChange();
  });

  return { get, set, input };
}
