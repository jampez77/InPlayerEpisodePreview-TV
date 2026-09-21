const path = require('path')

module.exports = (_env, argv = {}) => {
    const projectRoot = __dirname
    const mode = argv.mode || "production"
    
    return {
        context: projectRoot,
        mode,
        devtool: mode === "development" ? "source-map" : false,
        entry: "./Web/InPlayerPreview.ts",
        output: {
            path: path.resolve(projectRoot, "Web"),
            filename: "InPlayerPreview.js"
        },
        resolve: {
            extensions: [".ts", ".tsx", ".js"],
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: "ts-loader"
                },
                {
                    test: /\.css$/,
                    use: ["style-loader", "css-loader"]
                }
            ]
        }
    }
};
