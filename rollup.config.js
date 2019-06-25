import babel from 'rollup-plugin-babel';

export default {
  input: 'src/index.js',
  output: {
    file: 'lib/index.js',
    name: '@s524797336/restful-fetch',
    format: 'cjs'
  },
  plugins: [babel({
    presets: [
      ['@babel/env', {'modules': false}]
    ],
    exclude: 'node_modules/**'
  })],
};
