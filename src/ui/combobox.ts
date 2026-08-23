// A small, dependency-free ARIA combobox: type to filter, arrow keys to
// navigate, Enter/click to select. Built by hand rather than a native
// <datalist> because we want ranked substring matching and consistent
// styling across browsers for the app's primary interaction.
export interface ComboboxOption {
  id: string;
  label: string;
  sublabel?: string;
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
    close();
    onSelect(option);
  }

  input.addEventListener("input", () => {
    if (suppressNextInput) {
      suppressNextInput = false;
      return;
    }
    results = filterOptions(input.value, getOptions(), maxResults);
    activeIndex = results.length > 0 ? 0 : -1;
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden && e.key !== "ArrowDown") return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (results.length === 0) return;
        activeIndex = (activeIndex + 1) % results.length;
        render();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (results.length === 0) return;
        activeIndex = (activeIndex - 1 + results.length) % results.length;
        render();
        break;
      case "Enter": {
        const chosen = results[activeIndex] ?? results[0];
        if (chosen) {
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

  input.addEventListener("blur", () => close());

  return {
    setDisplayValue(value: string) {
      suppressNextInput = true;
      input.value = value;
    },
  };
}
