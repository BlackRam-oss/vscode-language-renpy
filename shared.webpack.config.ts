import * as path from "path";
import { Compiler, Configuration, WebpackPluginInstance } from "webpack";
import CopyWebpackPlugin from "copy-webpack-plugin";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";

const PATHS = {
    src: path.join(__dirname, "src"),
    dist: path.join(__dirname, "dist"),
    cache: path.join(__dirname, "node_modules/.cache/webpack"),
    node: path.join(__dirname, "node_modules"),
};

export const basePlugins: (((this: Compiler, compiler: Compiler) => void) | WebpackPluginInstance)[] = [
    new CopyWebpackPlugin({
        patterns: [{ from: "client/src", to: ".", globOptions: { ignore: ["**/test/**", "**/*.ts"] }, noErrorOnMissing: true }],
    }),
    new ForkTsCheckerWebpackPlugin({
        typescript: {
            diagnosticOptions: {
                semantic: true,
                syntactic: true,
            },
            mode: "write-references",
        },
    }),
];

export const baseConfig: Configuration = {
    mode: "none", // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        // configure TypeScript loader:
                        // * enable sources maps for end-to-end source maps
                        loader: "ts-loader",
                        options: {
                            compilerOptions: {
                                sourceMap: true,
                            },
                        },
                    },
                ],
            },
        ],
    },
    externals: {
        vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    },
    devtool: "source-map",

    cache: {
        type: "filesystem",
        buildDependencies: {
            // This makes all dependencies of this file - build dependencies
            config: [__filename],
            // By default webpack and loaders are build dependencies
        },
        cacheDirectory: PATHS.cache,
    },

    plugins: [...basePlugins],

    watchOptions: {
        // for some systems, watching many files can result in a lot of CPU or memory usage
        // https://webpack.js.org/configuration/watch/#watchoptionsignored
        // don't use this pattern, if you have a monorepo with linked packages
        ignored: /node_modules/,
    },

    optimization: {
        splitChunks: {
            chunks: "async",
        },
    },

    stats: "normal",
};

export const nodeConfig: Configuration = {
    target: "node", // extensions run in a node context
    node: {
        __dirname: false, // leave the __dirname-behaviour intact
    },
    resolve: {
        // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
        conditionNames: ["import", "require", "node"],
        mainFields: ["module", "main"],
        extensions: [".ts", ".js"], // support ts-files and js-files
    },
    ...baseConfig,
};

export default nodeConfig;
