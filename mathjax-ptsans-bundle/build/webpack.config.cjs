const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
module.exports = {
  name: 'tex-mml-svg-mathjax-ptsans',
  entry: path.resolve(__dirname, 'tex-mml-svg-mathjax-ptsans.js'),
  output: { path: path.resolve(__dirname, '..'), filename: 'tex-mml-svg-mathjax-ptsans.js' },
  target: ['web', 'es5'],
  plugins: [
    new webpack.NormalModuleReplacementPlugin(/#default-font/, function(r) { r.request = r.request.replace(/#default-font/, path.resolve(__dirname, '..', 'cjs')); }),
    new webpack.NormalModuleReplacementPlugin(/@mathjax\/mathjax-newcm-font\/cjs/, function(r) { r.request = r.request.replace(/@mathjax\/mathjax-newcm-font\/cjs/, path.resolve(__dirname, '..', 'cjs')); })
  ],
  resolve: { alias: { '#default-font': path.resolve(__dirname, '..', 'cjs') }, fallback: {} },
  performance: { hints: false },
  optimization: { minimize: true, minimizer: [new TerserPlugin({ extractComments: false, terserOptions: { output: { ascii_only: true } } })] },
  mode: 'production'
};
