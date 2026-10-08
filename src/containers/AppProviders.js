import { compose } from 'redux';
import { connect } from 'react-redux';
import { withPlugins } from '../extend/withPlugins';
import { getConfig, getTheme } from '../state/selectors';
import { AppProviders } from '../components/AppProviders';

/**
 * mapStateToProps - to hook up connect
 * @memberof App
 * @private
 */
const mapStateToProps = (state) => ({
  language: getConfig(state).language,
  // A host page that styles the viewer itself (MapViewer's site preset) needs Mirador's
  // Emotion styles inserted before its own CSS, so its rules win at equal specificity.
  prependStyles: getConfig(state).styles?.prepend === true,
  theme: getTheme(state),
  translations: getConfig(state).translations,
});

const enhance = compose(connect(mapStateToProps), withPlugins('AppProviders'));

export default enhance(AppProviders);
