import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider, StyledEngineProvider, createTheme } from '@mui/material/styles';
import { DndContext, DndProvider } from 'react-dnd';
import { MultiBackend } from 'react-dnd-multi-backend';
import { HTML5toTouch } from 'rdndmb-html5-to-touch';
import rtlPlugin from 'stylis-plugin-rtl';
import { prefixer } from 'stylis';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import createI18nInstance from '../i18n';
import FailedImageProvider from '../contexts/FailedImageProvider';
import { FullScreen, useFullScreenHandle } from '../lib/FullScreenHandle';
import FullScreenContext from '../contexts/FullScreenContext';
import LocaleContext from '../contexts/LocaleContext';

/**
 * Allow applications to opt-out of (or provide their own) drag and drop context
 */
const MaybeDndProvider = ({ dndManager = undefined, children }) => {
  if (dndManager === false) {
    return children;
  }

  if (dndManager === undefined) {
    return (
      <DndProvider backend={MultiBackend} options={HTML5toTouch}>
        {children}
      </DndProvider>
    );
  }

  return <DndContext.Provider value={dndManager}>{children}</DndContext.Provider>;
};

MaybeDndProvider.propTypes = {
  children: PropTypes.node.isRequired,
  dndManager: PropTypes.oneOf([undefined, false, PropTypes.object]),
};

/**
 * Shim to inject the full screen handle into a context
 */
const FullScreenShim = ({ children }) => {
  const handle = useFullScreenHandle();

  return (
    <FullScreen handle={handle}>
      <FullScreenContext.Provider value={handle}>{children}</FullScreenContext.Provider>
    </FullScreen>
  );
};

FullScreenShim.propTypes = {
  children: PropTypes.node.isRequired,
};

/**
 * Hook up the I18next provider to the configuration in redux to allow
 * plugins + config to inject additional translations.
 */
const StoreAwareI18nextProvider = ({ children, language, translations }) => {
  const [i18n] = useState(createI18nInstance({ lng: language }));
  useEffect(() => {
    if (i18n && i18n.language !== language) i18n.changeLanguage(language);
  }, [i18n, language]);

  useEffect(() => {
    Object.keys(translations).forEach((lng) => {
      i18n.addResourceBundle(lng, 'translation', translations[lng], true, true);
    });
  }, [i18n, translations]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
};

StoreAwareI18nextProvider.propTypes = {
  children: PropTypes.node.isRequired,
  language: PropTypes.string.isRequired,
  translations: PropTypes.object.isRequired,
};

/**
 * Create rtl emotion cache
 */
const cacheRtl = createCache({
  key: 'muirtl',
  stylisPlugins: [prefixer, rtlPlugin],
});

/**
 * Create default emotion cache
 */
const cacheDefault = createCache({
  key: 'mui',
});

/**
 * The same caches, inserting their styles at the start of <head> rather than the end, so a
 * host page's own stylesheets override Mirador's at equal specificity (`config.styles.prepend`).
 */
const cacheRtlPrepended = createCache({
  key: 'muirtl',
  prepend: true,
  stylisPlugins: [prefixer, rtlPlugin],
});
const cacheDefaultPrepended = createCache({
  key: 'mui',
  prepend: true,
});

const emotionCache = (direction, prepend) => {
  if (direction === 'rtl') return prepend ? cacheRtlPrepended : cacheRtl;
  return prepend ? cacheDefaultPrepended : cacheDefault;
};

/**
 * This component adds viewer-specific providers.
 * @prop {Object} manifests
 */
export function AppProviders({ children = null, language, theme, translations, dndManager = undefined, prependStyles = false }) {
  return (
    <FullScreenShim>
      <StoreAwareI18nextProvider language={language} translations={translations}>
        <LocaleContext.Provider value={language}>
          <StyledEngineProvider injectFirst>
            <CacheProvider value={emotionCache(theme.direction, prependStyles)}>
              <ThemeProvider theme={createTheme(theme)}>
                <MaybeDndProvider dndManager={dndManager}>
                  <FailedImageProvider>{children}</FailedImageProvider>
                </MaybeDndProvider>
              </ThemeProvider>
            </CacheProvider>
          </StyledEngineProvider>
        </LocaleContext.Provider>
      </StoreAwareI18nextProvider>
    </FullScreenShim>
  );
}

AppProviders.propTypes = {
  children: PropTypes.node,
  dndManager: PropTypes.object,
  language: PropTypes.string.isRequired,
  prependStyles: PropTypes.bool,
  theme: PropTypes.object.isRequired,
  translations: PropTypes.object.isRequired,
};
