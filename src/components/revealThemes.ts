// Import all reveal.js theme CSS as raw strings using Vite's ?inline
import white from 'reveal.js/dist/theme/white.css?inline';
import black from 'reveal.js/dist/theme/black.css?inline';
import league from 'reveal.js/dist/theme/league.css?inline';
import beige from 'reveal.js/dist/theme/beige.css?inline';
import moon from 'reveal.js/dist/theme/moon.css?inline';
import solarized from 'reveal.js/dist/theme/solarized.css?inline';
import night from 'reveal.js/dist/theme/night.css?inline';
import serif from 'reveal.js/dist/theme/serif.css?inline';
import simple from 'reveal.js/dist/theme/simple.css?inline';
import sky from 'reveal.js/dist/theme/sky.css?inline';
import blood from 'reveal.js/dist/theme/blood.css?inline';
import dracula from 'reveal.js/dist/theme/dracula.css?inline';

export const THEME_CSS: Record<string, string> = {
  white,
  black,
  league,
  beige,
  moon,
  solarized,
  night,
  serif,
  simple,
  sky,
  blood,
  dracula,
};
