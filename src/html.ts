export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** The shared name field used by the leaderboard and rooms. */
export const nameForm = (id: string, action: string, cancel: string) => `<form class="history-toolbar" data-form="${id}">
  <input data-field="name" aria-label="Name" placeholder="Name" autocomplete="nickname" maxlength="16" spellcheck="false"/>
  <button class="settings-button" data-field="save">${action}</button>
  <button type="button" class="settings-button" data-field="cancel">${cancel}</button>
</form>`;
