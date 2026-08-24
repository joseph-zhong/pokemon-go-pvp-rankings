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

  // Clear the field on focus so clicking in to type a new value doesn't
  // require first deleting the old one. The value picked up on focus is
  // restored on blur if the user leaves without typing anything.
  let valueBeforeFocus = get();
  input.addEventListener("focus", () => {
    valueBeforeFocus = get();
    input.value = "";
  });

  // Snap out-of-range or partial values back into 0-15 once the user leaves the field.
  // An empty field (left blank after the focus-clear above) restores the pre-focus value
  // instead of snapping to 0.
  input.addEventListener("blur", () => {
    set(input.value.trim() === "" ? valueBeforeFocus : get());
    onChange();
  });

  return { get, set, input };
}
