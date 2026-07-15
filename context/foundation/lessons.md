# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## No-misused-promises crashes on top-level return in Astro frontmatter

- **Context**: pliki .astro z top-level `return` we frontmatterze; konfiguracja ESLint (eslint.config.js)
- **Problem**: top-level return w .astro frontmatterze (np. return Astro.redirect(...)) crashuje regułę @typescript-eslint/no-misused-promises (nullThrows: Expected node to have a parent) zamiast zwykłego błędu lintu — wywala cały krok CI lint z exit code 2.
- **Rule**: W plikach .astro no-misused-promises jest wyłączone w eslint.config.js z powodu niekompatybilności astro-eslint-parser@1.x z tą regułą przy top-level return we frontmatterze. Nie włączaj jej ponownie bez upgrade'u eslint-plugin-astro do wersji wspierającej ESLint 10 (co wymaga też eslint-plugin-react/jsx-a11y z obsługą ESLint 10).
- **Applies to**: implement, impl-review
