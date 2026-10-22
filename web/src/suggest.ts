// A light autocomplete for the From and To boxes (WAI-ARIA combobox pattern).
// A <datalist> of every district and station made phones slow on each keystroke;
// this shows only the best eight matches and understands old names too.

import { normalise, type Place, searchPlaces } from './places';

const LIMIT = 8;

export function attachSuggest(input: HTMLInputElement, places: () => Place[] | null) {
  const list = document.createElement('ul');
  list.id = `${input.id}-suggestions`;
  list.className = 'suggestions';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Suggestions');
  list.hidden = true;
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');

  let items: Place[] = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index: number) {
    active = index;
    for (const [i, li] of [...list.children].entries()) li.setAttribute('aria-selected', String(i === index));
    if (index >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${index}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function choose(index: number) {
    input.value = items[index].label;
    close();
  }

  function update() {
    const all = places();
    items = all ? searchPlaces(input.value, all, LIMIT) : [];
    // Nothing to pick when the box already names the top match exactly ("Patna", "Bangalore"):
    // keep the list from covering the Find button.
    const typed = normalise(input.value);
    if (!items.length || items[0].key === typed || items[0].terms.includes(typed)) return close();
    list.replaceChildren(
      ...items.map((p, i) => {
        const li = document.createElement('li');
        li.id = `${list.id}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = p.label;
        // pointerdown, not click: choose before the input loses focus and closes the list.
        li.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          choose(i);
        });
        return li;
      }),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  }

  input.addEventListener('input', update);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlight((active + step + items.length) % items.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
}
