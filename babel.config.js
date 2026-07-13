const presets = [
    [
        "@babel/env",
        {
            targets: {
                "browsers": ["chrome >= 40 or firefox >= 35 or safari > 9"]
            },
            useBuiltIns: "usage",
            corejs: 3,
        },
    ],
];

module.exports = { presets };