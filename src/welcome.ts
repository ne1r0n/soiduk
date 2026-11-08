import { detectLang, LANG_NAMES, LANGS } from './i18n.ts';

/** First launch: one tap to pick the language. The browser's language is only a hint – many people use English on a Russian or Estonian phone. */
export function welcome(): string {
	const hint = detectLang();
	return `
    <main class="welcome">
      <h1>Sõiduk</h1>
      <p class="muted">Выберите язык · Choose your language · Valige keel</p>
      <div class="lang-list">
        ${LANGS.map((l) => `<button type="button" class="btn ${l === hint ? 'primary' : ''}" data-act="lang" data-lang="${l}">${LANG_NAMES[l]}</button>`).join('')}
      </div>
    </main>`;
}
