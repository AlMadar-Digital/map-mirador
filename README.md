# DBF Map Mirador

We forked the original Mirador project to create a version that is compatible with the DBF Map project. This version of Mirador is designed to work seamlessly with the DBF Map platform, providing users with an enhanced experience for viewing and interacting with digital content. More detail about the original Mirador project can be found [here](https://github.com/ProjectMirador/mirador). This readme will cover only minimal information about the original Mirador project and will focus on the changes made to support the DBF Map project.

We provided a ready to use component called `MapViewer` See below for more details.

<!-- TOC -->
* [DBF Map Mirador](#dbf-map-mirador)
  * [Running Mirador locally for development](#running-mirador-locally-for-development)
  * [Install Mirador inside your project](#install-mirador-inside-your-project-)
    * [`MapViewer` component](#mapviewer-component)
    * [Mirador](#mirador)
  * [Running the tests](#running-the-tests)
  * [Linting the project](#linting-the-project)
<!-- TOC -->


## Running Mirador locally for development

Mirador local development requires [nodejs](https://nodejs.org/en/download/) to be installed.

```
git clone git@github.com:AlMadar-Digital/map-mirador.git
cd map-mirador
npm install

npm start
```


Then navigate to [http://127.0.0.1:4444/](http://127.0.0.1:4444/)

## Install Mirador inside your project 

`dbf-mirador` is available through NPM

```sh
$ npm install dbf-mirador 
```

### `MapViewer` component

For consumers that just want to render a manifest as a map - without learning Mirador's own
config/plugin API - `MapViewer` is a React component that wraps `Mirador.viewer()` with a
preset config (annotation sidebar open by default, window chrome hidden, single-window
layout). The only required prop is the manifest URL:

Here the manifestId correspond to the manifest endpoint from the map object provided by Strapi. This endpoint provides the map data as a IIIF manifest.
You can use the following code snippet to render a map in your React application.

```jsx
import { MapViewer } from 'dbf-mirador';

function App() {
  return <MapViewer manifestId="https://files.tetras-libre.fr/dev/dbf/mapnile.json" />;
}
```

Run `npm start` and open `localhost:4444/demo/map-viewer.html` to see it live.

### Mirador

Check the `demo` folder for runnable examples, including `demo/index.html` (raw
`Mirador.viewer()` usage), `demo/map-viewer.html` (the `MapViewer` component below) and
`demo/map-editor.html` (the map preset plus `dbf-mirador-annotation-editor`, so POIs and
journeys can be created/edited against browser-local storage with no backend).


## Running the tests
We use Vitest to run our test suite.

```sh
$ npm test
```

You can see the helpful Vitest UI in your browser by running Vitest with the `--ui` flag. To pass the flag through to npm run the following:

```sh
$ npm test -- --ui
```

You can run Vitest without the additional linting and size checks in our `npm test` command. You can also test a single file:
```sh
$ npx vitest __tests__/integration/tests/sequence-switching.test.js --ui
```

## Linting the project

```sh
$ npm run lint
```

