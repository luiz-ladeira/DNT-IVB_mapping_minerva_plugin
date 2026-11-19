// Babel configuration for the plugin bundle: transpile to ES5 for the
// browsers MINERVA supports and add only the core-js polyfills the code uses.
module.exports = {
  presets: [
    [
      "@babel/preset-env",
      {
        targets: "chrome >= 40, firefox >= 35, safari > 9",
        useBuiltIns: "usage",
        corejs: 3,
      },
    ],
  ],
};
