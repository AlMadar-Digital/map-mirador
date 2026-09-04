import { createSelector } from 'reselect';
import deepmerge from 'deepmerge';
import { miradorSlice, EMPTY_ARRAY, EMPTY_OBJECT } from './utils';
import { getWorkspace } from './getters';
import { isRtlLanguage } from '../../lib/rtlLanguages';

/**
 * Returns the config from the redux state.
 * @param {object} state
 * @returns {object} containing config
 */
export function getConfig(state) {
  const slice = miradorSlice(state || {});
  return slice.config || EMPTY_OBJECT;
}

/**
 * Extract an exportable version of state using the configuration from the config.
 * @param {object} state
 * @returns {object} containing exportable state
 */
export function getExportableState(state) {
  const exportConfig = getConfig(state).export;

  return Object.entries(exportConfig).reduce((acc, [stem, value]) => {
    if (value === true) {
      // eslint-disable-next-line no-param-reassign
      acc[stem] = state[stem];
    } else if (value.filter) {
      // eslint-disable-next-line no-param-reassign
      acc[stem] = Object.entries(state[stem])
        .filter(value.filter)
        .reduce((stemAcc, [k, v]) => {
          // eslint-disable-next-line no-param-reassign
          stemAcc[k] = v;
          return stemAcc;
        }, {});
    }
    return acc;
  }, {});
}

/**
 * Return languages from config (in state) and indicate which is currently set.
 * @param {object} state
 * @returns {Array} [ {locale: 'de', label: 'Deutsch', current: true}, ... ]
 */
export const getLanguagesFromConfigWithCurrent = createSelector([getConfig], ({ availableLanguages, language }) =>
  Object.keys(availableLanguages).map((key) => ({
    current: key === language,
    label: availableLanguages[key],
    locale: key,
  })),
);

/**
 * Returns if showZoomControls is set in the config.
 * @param {object} state
 * @returns {boolean}
 */
export const getShowZoomControlsConfig = createSelector([getWorkspace, getConfig], (workspace, config) =>
  workspace.showZoomControls === undefined ? config.workspace.showZoomControls : workspace.showZoomControls,
);

/**
 * Returns the theme from the config. When no `direction` is explicitly configured (on the base
 * theme or the selected named theme), one is derived from the active UI language - e.g. Arabic
 * (`ar`) implies `rtl` - rather than always defaulting to `ltr` regardless of language.
 * @param {object} state
 * @returns {object} {palette: {...}, typography: {...}, overrides: {...}, ...}
 */
export const getTheme = createSelector([getConfig], ({ theme, themes, selectedTheme, language }) => {
  const merged = deepmerge(theme, themes[selectedTheme] || {});
  return merged.direction || !isRtlLanguage(language) ? merged : { ...merged, direction: 'rtl' };
});

/**
 * Returns the theme ids from the config.
 * @param {object} state
 * @returns {Array} ['dark', 'light']
 */
export const getThemeIds = createSelector([getConfig], ({ themes }) => Object.keys(themes));

/* @deprecated */
export const getContainerId = createSelector([getConfig], ({ id }) => id);

/**
 * Returns the theme direction from the config, falling back to a language-derived default (see
 * getTheme) when no direction is explicitly configured.
 * @param {object} state
 * @returns {string}
 */
export const getThemeDirection = createSelector(
  [getConfig],
  ({ theme, language }) => theme.direction || (isRtlLanguage(language) ? 'rtl' : 'ltr'),
);
/**
 * Returns the requests configurations from the config.
 * @param {object} state
 * @returns {object} {preprocessor: [...], postprocessor: [...]}
 */
export const getRequestsConfig = createSelector([getConfig], ({ requests }) => requests || EMPTY_OBJECT);
/**
 * Returns the thumbnails configurations from the config.
 * @param {object} state
 * @returns {object} {preprocessor: [...], postprocessor: [...]}
 */
export const getThumbnailsConfig = createSelector([getConfig], ({ thumbnails }) => thumbnails || EMPTY_OBJECT);
