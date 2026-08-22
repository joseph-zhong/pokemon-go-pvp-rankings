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

  // Snap out-of-range or partial values back into 0-15 once the user leaves the field.
  input.addEventListener("blur", () => {
    set(get());
    onChange();
  });

  return { get, set, input };
}
