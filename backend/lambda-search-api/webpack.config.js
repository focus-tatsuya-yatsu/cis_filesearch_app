const path = require('path');

module.exports = {
  target: 'node',
  mode: process.env.NODE_ENV || 'production',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  externals: {
    // AWS SDK v3はLambda環境に含まれているため除外
    '@aws-sdk/client-opensearch': 'commonjs @aws-sdk/client-opensearch',
    '@aws-sdk/client-cloudwatch': 'commonjs @aws-sdk/client-cloudwatch',
  },
  optimization: {
    minimize: true,
  },
  devtool: false,
};
