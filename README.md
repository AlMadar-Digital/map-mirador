# DBF Map Mirador

We forked the original Mirador project to create a version that is compatible with the DBF Map project. This version of Mirador is designed to work seamlessly with the DBF Map platform, providing users with an enhanced experience for viewing and interacting with digital content. More detail about the original Mirador project can be found [here](https://github.com/ProjectMirador/mirador). This readme will cover only minimal information about the original Mirador project and will focus on the changes made to support the DBF Map project.

## Running Mirador locally for development

Mirador local development requires [nodejs](https://nodejs.org/en/download/) to be installed.

```
git clone git@github.com:AlMadar-Digital/map-mirador.git
cd map-mirador
npm install

```
Then run the following command to start a local development server:

```sh
$ npm start
```

Then navigate to [http://127.0.0.1:4444/](http://127.0.0.1:4444/)

## Install Mirador inside your project 

`dbf-mirador` is available through NPM

```sh
$ npm install dbf-mirador 
```

### Mirador 

Check the demo folder TODO

### Instantiating Mirador

```javascript
var miradorInstance = Mirador.viewer({
  id: 'mirador' // id selector where Mirador should be instantiated
});

> miradorInstance
{ actions, store }
```


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

