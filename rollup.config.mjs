import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const isProd = process.env.BUILD === "production";

export default {
  input: "src/main.ts",
  output: {
    dir: ".",
    format: "cjs",
    sourcemap: "inline"
  },
  external: ["obsidian", "electron", "child_process", "fs", "path"],
  plugins: [
    nodeResolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: "tsconfig.json" })
  ]
};
