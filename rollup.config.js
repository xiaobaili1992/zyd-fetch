import resolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.js',
  output: [{
    file: 'dist/index-es.js',
    format: 'es'
  }, {
    file: 'dist/index.js',
    format: 'umd',
    name: 'libBuild'
  }],
  plugins: [resolve(),  babel({ babelHelpers: 'bundled' }), commonjs(), terser()]
}
