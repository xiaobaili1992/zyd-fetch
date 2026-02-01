import resolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: [{
    file: 'dist/index-es.js',
    format: 'es'
  }, {
    file: 'dist/index.js',
    format: 'umd',
    name: 'libBuild',
    globals: {
      axios: 'axios',
      'ali-oss': 'OSS'
    }
  }],
  external: ['axios', 'ali-oss'],
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
    babel({ 
      babelHelpers: 'bundled', 
      extensions: ['.ts', '.js'] 
    }),
    terser()
  ]
}
