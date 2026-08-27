// A small, dependency-free ARIA combobox: type to filter, arrow keys to
// navigate, Enter/click to select. Built by hand rather than a native
// <datalist> because we want ranked substring matching and consistent
// styling across browsers for the app's primary interaction.
export interface ComboboxOption {
  id: string;
  label: string;
  sublabel?: string;
  /** When set, the option renders disabled (dimmed, not selectable) with this shown as the reason — e.g. "not eligible this cup". Disabled options stay in the list rather than being filtered out, so the rule is visible instead of the option just silently missing. */
  disabledReason?: string;
}

export interface ComboboxDeps {
  input: HTMLInputElement;
  list: HTMLUListElement;
  getOptions: () => ComboboxOption[];
  onSelect: (option: ComboboxOption) => void;
  maxResults?: number;
}

export interface ComboboxHandle {
  /** Sets the input's displayed text without triggering a filter/search. */
  setDisplayValue(value: string): void;
}

function filterOptions(query: string, options: ComboboxOption[], maxResults: number): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const startsWith: ComboboxOption[] = [];
  const contains: ComboboxOption[] = [];
  for (const option of options) {
    const label = option.label.toLowerCase();
    if (label.startsWith(q)) startsWith.push(option);
    else if (label.includes(q)) contains.push(option);
    if (startsWith.length >= maxResults) break;
  }
  return [...startsWith, ...contains].slice(0, maxResults);
}

export function createCombobox({ input, list, getOptions, onSelect, maxResults = 30 }: ComboboxDeps): ComboboxHandle {
  let results: ComboboxOption[] = [];
  let activeIndex = -1;
  let suppressNextInput = false;
  let valueBeforeFocus = input.value;

  function render() {
    list.innerHTML = "";
    if (results.length === 0) {
      close();
      return;
    }
    results.forEach((option, i) => {
      const li = document.createElement("li");
      li.id = `pokemon-option-${i}`;
      li.className = "combobox-option";
      li.role = "option";
      li.setAttribute("aria-selected", String(i === activeIndex));

      const name = document.createElement("span");
      name.textContent = option.label;
      li.appendChild(name);

      if (option.disabledReason) {
        li.classList.add("combobox-option-disabled");
        li.setAttribute("aria-disabled", "true");
        const reason = document.createElement("span");
        reason.className = "dex";
        reason.textContent = option.disabledReason;
        li.appendChild(reason);
      } else {
        if (option.sublabel) {
          const dex = document.createElement("span");
          dex.className = "dex";
          dex.textContent = option.sublabel;
          li.appendChild(dex);
        }
        li.addEventListener("mousedown", (e) => {
          // mousedown (not click) so this fires before the input's blur handler.
          e.preventDefault();
          select(option);
        });
      }
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", activeIndex >= 0 ? `pokemon-option-${activeIndex}` : "");
  }

  function close() {
    list.hidden = true;
    list.innerHTML = "";
    results = [];
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function select(option: ComboboxOption) {
    suppressNextInput = true;
    input.value = option.label;
    valueBeforeFocus = option.label; // keep in sync so a later blur doesn't revert this pick
    close();
    onSelect(option);
  }

  // Disabled options stay in the list (see ComboboxOption.disabledReason)
  // but keyboard navigation steps over them — landing on an unselectable
  // item would be a dead end for keyboard users.
  function stepIndex(from: number, direction: 1 | -1): number {
    const n = results.length;
    if (n === 0) return -1;
    let next = from;
    for (let steps = 0; steps < n; steps++) {
      next = next + direction;
      if (next >= n) next = 0;
      if (next < 0) next = n - 1;
      if (!results[next]!.disabledReason) return next;
    }
    return -1;
  }

  input.addEventListener("input", () => {
    if (suppressNextInput) {
      suppressNextInput = false;
      return;
    }
    results = filterOptions(input.value, getOptions(), maxResults);
    activeIndex = stepIndex(-1, 1);
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden && e.key !== "ArrowDown") return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        activeIndex = stepIndex(activeIndex, 1);
        render();
        break;
      case "ArrowUp":
        e.preventDefault();
        activeIndex = stepIndex(activeIndex, -1);
        render();
        break;
      case "Enter": {
        const chosen = results[activeIndex];
        if (chosen && !chosen.disabledReason) {
          e.preventDefault();
          select(chosen);
        }
        break;
      }
      case "Escape":
        close();
        break;
    }
  });

  // Clear on focus so clicking in to search again doesn't require deleting
  // the current selection first (same pattern as the IV steppers); blurring
  // without picking anything restores it instead of leaving the field
  // empty or full of an unmatched search term. Also clear on click, not
  // just focus: selecting an option leaves the input focused (select()
  // preventDefaults the option's mousedown so the browser never moves
  // focus away), so a follow-up click into the already-focused field
  // wouldn't otherwise fire a fresh focus event.
  function clearForSearch() {
    if (input.value === "") return;
    valueBeforeFocus = input.value;
    input.value = "";
  }
  input.addEventListener("focus", clearForSearch);
  input.addEventListener("click", clearForSearch);

  input.addEventListener("blur", () => {
    close();
    input.value = valueBeforeFocus;
  });

  return {
    setDisplayValue(value: string) {
      suppressNextInput = true;
      input.value = value;
      valueBeforeFocus = value;
    },
  };
}
